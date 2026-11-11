// feature 015: the tool-call turn loop (research D1/D2/D6/D8, tasks T011).
// Wraps a single generate call: on a complete ````tool_call` block the
// engine stops, the call goes through verdict → approval → execution,
// a fenced ````tool_result` is appended to the stream, and generation
// continues via the KV-prefix `lls_generate_continue` path.
import type {
  GenerationParams,
  ToolCallRecord,
} from "../../shared/types";
import {
  parseCallBody,
  renderResultBlock,
  scanBlocks,
  TOOL_CALL_FENCE,
  TOOL_RESULT_FENCE,
} from "../../shared/tool-call";
import type { SnapshotStore } from "../kv/store";
import { recordAudit } from "./audit";
import { runTool } from "./executor";
import type { ToolDecision, ToolService } from "./service";

export const TOOL_BUDGET = 5;

export interface LoopGenerateResult {
  status: "complete" | "partial";
  tokens: number;
  elapsedMs: number;
  warm: boolean;
  promptTokens?: number;
}

export interface LoopEngine {
  generate(
    prompt: string,
    onToken: (delta: string) => void,
    params?: GenerationParams | null,
    opts?: {
      conversationId?: string;
      roleKey?: string;
      snapshot?: SnapshotStore;
    },
  ): Promise<LoopGenerateResult>;
  stop(): void;
  tokenCount?(text: string): number;
}

export interface ToolLoopOpts {
  tools: ToolService;
  conversationId: string;
  messageId: string;
  // append raw stream text (prose + blocks + injected results) — the
  // caller mirrors it into message content and chat.token
  onDelta: (text: string) => void;
  // every ToolCallRecord transition → tool.update + record collection
  onCall: (call: ToolCallRecord) => void;
  onBudgetWarning: () => void;
  // user-stop check (pendingStop) — evaluated at pause points
  isStopped: () => boolean;
  genParams?: GenerationParams | null;
  genOpts?: {
    conversationId?: string;
    roleKey?: string;
    snapshot?: SnapshotStore;
  };
  budget?: number;
}

export interface ToolLoopResult {
  status: "complete" | "partial";
  tokens: number;
  elapsedMs: number;
  warm: boolean;
  promptTokens: number;
  calls: ToolCallRecord[];
}

const newId = () => crypto.randomUUID();
const now = () => new Date().toISOString();

const isCtxOverflow = (e: unknown) =>
  e instanceof Error && e.message.includes("context window");

const preview = (s: string) => s.replace(/\s+/g, " ").slice(0, 200);

// replace the bodies of all but the newest `keep` tool_result blocks
// with an elision marker — used to shrink a continuation prompt that
// overflowed (the displayed stream is untouched)
function elideResults(text: string, keep: number): string {
  const blocks = scanBlocks(text).filter(
    (b) => b.fence === TOOL_RESULT_FENCE,
  );
  if (blocks.length <= keep) return text;
  const elide = blocks.slice(0, blocks.length - keep);
  let out = "";
  let pos = 0;
  for (const b of elide) {
    out += text.slice(pos, b.start);
    out +=
      "```tool_result\n{\"status\":\"elided\",\"content\":\"[result elided for context]\"}\n```";
    pos = b.end;
  }
  return out + text.slice(pos);
}

// the tool loop: drives generate → detect → verdict → execute →
// continue until natural end, user stop, or budget cap.
export async function runToolLoop(
  eng: LoopEngine,
  initialPrompt: string,
  opts: ToolLoopOpts,
): Promise<ToolLoopResult> {
  const budget = opts.budget ?? TOOL_BUDGET;
  const calls: ToolCallRecord[] = [];
  let handled = 0; // call blocks already given a verdict
  let disarmed = false; // budget spent — no more pauses
  let acc = ""; // whole raw turn text (prose + call/result blocks)
  let prompt = initialPrompt;
  // chars of `prompt` already resident in KV — the newly-prefilled
  // suffix is prompt.slice(prevPromptLen); reset on elision rebuild
  let prevPromptLen = 0;
  let tokens = 0;
  let elapsedMs = 0;
  let warm = false;
  let promptTokens = 0;
  let elided = false;

  const emit = (c: ToolCallRecord) => {
    if (!calls.includes(c)) calls.push(c);
    opts.onCall(c);
  };
  const refuse = (
    c: ToolCallRecord,
    reason: NonNullable<ToolCallRecord["refuseReason"]>,
    error: string,
    inject: string,
  ) => {
    c.status = "refused";
    c.refuseReason = reason;
    c.error = error;
    c.decidedAt = now();
    emit(c);
    return renderResultBlock({ status: "refused", content: inject });
  };

  for (;;) {
    // generate until end or a complete unhandled tool_call block
    let stoppedOnBlock = false;
    let res;
    try {
      // oxlint-disable-next-line no-await-in-loop -- sequential turn steps
      res = await eng.generate(
        prompt,
        (delta) => {
          acc += delta;
          opts.onDelta(delta);
          if (!disarmed && !stoppedOnBlock) {
            const blocks = scanBlocks(acc).filter(
              (b) => b.fence === TOOL_CALL_FENCE,
            );
            if (blocks.length > handled) {
              stoppedOnBlock = true;
              eng.stop();
            }
          }
        },
        opts.genParams,
        opts.genOpts,
      );
    } catch (e) {
      // overflow on a continuation: elide old results once and retry —
      // the prefix mismatches KV so this is a cold re-prefill (D1/U1)
      if (isCtxOverflow(e) && !elided && acc !== "") {
        elided = true;
        prompt = initialPrompt + elideResults(acc, 1);
        prevPromptLen = 0;
        continue;
      }
      throw e;
    }
    tokens += res.tokens;
    elapsedMs += res.elapsedMs;
    warm ||= res.warm;
    // prefer the engine's exact count when it reports one; otherwise
    // estimate just the newly-prefilled suffix on continuations
    promptTokens +=
      res.promptTokens ??
      (eng.tokenCount
        ? eng.tokenCount(
            prompt.slice(Math.min(prevPromptLen, prompt.length)),
          )
        : 0);

    const callBlocks = scanBlocks(acc).filter(
      (b) => b.fence === TOOL_CALL_FENCE,
    );
    const inert = (
      b: (typeof callBlocks)[number],
      status: "denied" | "refused",
      reason: ToolCallRecord["refuseReason"],
      error: string,
    ) => {
      const p = parseCallBody(b.body);
      emit({
        id: newId(),
        tool: p.ok ? p.tool : null,
        path: p.ok ? p.path : "",
        status,
        refuseReason: reason,
        error,
        createdAt: now(),
        decidedAt: now(),
      });
    };

    if (opts.isStopped() || (res.status === "partial" && !stoppedOnBlock)) {
      // user stop (or a stop that raced a block) → inert records for
      // unhandled blocks, end partial. Our own block-stop also returns
      // "partial" — fall through to process the detected call.
      for (const b of callBlocks.slice(handled)) {
        inert(b, "denied", undefined, "stopped");
      }
      return { status: "partial", tokens, elapsedMs, warm, promptTokens, calls };
    }

    const next = disarmed ? undefined : callBlocks[handled];
    if (!next) {
      // natural end — blocks detected after the budget was spent get
      // inert refused records without pausing (D8)
      for (const b of callBlocks.slice(handled)) {
        inert(b, "refused", "budget", "tool budget exhausted");
      }
      return { status: res.status, tokens, elapsedMs, warm, promptTokens, calls };
    }
    handled += 1;

    // verdict pipeline: parse → active? → sandbox → approval → execute
    const parsed = parseCallBody(next.body);
    const call: ToolCallRecord = {
      id: newId(),
      tool: parsed.ok ? parsed.tool : null,
      path: parsed.ok ? parsed.path : "",
      status: "refused",
      createdAt: now(),
    };

    let resultText: string;
    if (!parsed.ok) {
      resultText = refuse(call, "malformed", parsed.detail,
        `malformed tool call: ${parsed.detail}`);
    } else {
      const sb = opts.tools.active() ? opts.tools.sandbox() : null;
      if (!sb) {
        resultText = refuse(call, "disabled", "tools disabled",
          "tools are disabled");
      } else {
        const res2 = sb.resolve(parsed.path);
        if (!res2.ok && res2.reason === "out-of-sandbox") {
          resultText = refuse(call, "out-of-sandbox",
            "outside sandbox root",
            `refused: ${parsed.path} is outside the sandbox`);
        } else {
          call.resolvedPath = res2.ok ? res2.resolved : undefined;
          // pending → decision; auto-approve skips the prompt entirely.
          // Register the deferral BEFORE emitting pending — a respond
          // arriving inside onCall must find the map entry.
          let decision: ToolDecision = "approve";
          if (!opts.tools.autoApprove(opts.conversationId)) {
            const deferred = opts.tools.awaitDecision(
              call.id,
              opts.messageId,
              opts.conversationId,
            );
            call.status = "pending";
            emit(call);
            // oxlint-disable-next-line no-await-in-loop -- approval pauses the turn
            decision = await deferred;
          }
          if (decision === "discard" || opts.isStopped()) {
            call.status = "denied";
            call.error = "stopped";
            call.decidedAt = now();
            emit(call);
            return {
              status: "partial", tokens, elapsedMs, warm, promptTokens, calls,
            };
          }
          if (decision === "deny") {
            call.status = "denied";
            call.decidedAt = now();
            emit(call);
            resultText = renderResultBlock({
              status: "denied",
              content: "the user denied this tool call",
            });
          } else {
            call.status = "approved";
            call.decidedAt = now();
            emit(call);
            const r = res2.ok
              ? runTool(parsed.tool, res2.resolved)
              : {
                  ok: false as const,
                  content: "",
                  truncated: false,
                  bytes: 0,
                  error: `no such file or directory: ${parsed.path}`,
                };
            call.status = r.ok ? "executed" : "error";
            call.error = r.error;
            call.resultBytes = r.bytes;
            call.resultPreview = r.ok ? preview(r.content) : undefined;
            call.decidedAt = now();
            emit(call);
            recordAudit({
              ts: now(),
              conversationId: opts.conversationId,
              messageId: opts.messageId,
              callId: call.id,
              tool: parsed.tool,
              path: parsed.path,
              resolvedPath: call.resolvedPath ?? "",
              verdict: r.ok ? "executed" : "error",
              resultBytes: r.bytes,
              error: r.error,
            });
            resultText = renderResultBlock(
              r.ok
                ? { status: "ok", content: r.content }
                : { status: "error", content: `error: ${r.error}` },
            );
          }
        }
      }
    }

    // inject the result into the stream + continuation prompt
    opts.onDelta(resultText);
    acc += resultText;

    if (handled >= budget) {
      // cap consumed — tell the model, disarm, warn once (FR-008)
      const spent = renderResultBlock({
        status: "error",
        content:
          "tool budget exhausted — finish your answer without more tool calls",
      });
      opts.onDelta(spent);
      acc += spent;
      disarmed = true;
      opts.onBudgetWarning();
    }

    prompt = initialPrompt + acc;
    prevPromptLen = prompt.length;
  }
}
