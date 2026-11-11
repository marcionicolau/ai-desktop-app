// FusionOrchestrator (research D4): sequential two-phase turn —
// planner -> executor — as a small state machine. Each phase is a normal
// budgeted generate on its own resolved slot; the registry shares slots
// when both roles bind the same file (FR-011). Single-flight semantics
// are unchanged: the whole turn is one run under the ENGINE_BUSY gate.
import type {
  FusionPhase,
  GenerationParams,
  MessageStats,
  MetricEntry,
  ResolvedRole,
  ToolCallRecord,
} from "../../shared/types";
import type { ModelRegistry, SlotEngine } from "../models/registry";
import type { SnapshotStore } from "../kv/store";
import type { ToolService } from "../tools/service";
import { runToolLoop } from "../tools/loop";
import { buildExecutorPrompt, buildPlannerPrompt } from "./plan-prompt";
import { buildPrompt, type PromptTurn } from "./prompt";

export interface FusionTurnOpts {
  // ordered candidates per role (T019): load/pre-token failures walk
  // the list; servedBy on the winner is emitted in chat.phase
  planner: ResolvedRole[];
  executor: ResolvedRole[];
  registry: ModelRegistry;
  // feature 010 (FR-007): per-phase snapshots keyed planner/executor
  snapshot?: SnapshotStore;
  conversationId: string;
  history: PromptTurn[]; // newest-first, same convention as chat path
  current: string; // the user's message text (may carry injected file blocks)
  // feature 009: planner sees the request + attachment summary instead of
  // full file content; defaults to `current` when unset (FR-008/D4)
  plannerText?: string;
  // feature 006 (FR-009): persona system prompt applies to the executor
  // phase only — the planner keeps its own planning directive
  executorSystem?: string;
  // events are re-emitted by the caller with messageId filled in
  onEvent: (method: "chat.phase" | "chat.token", payload: unknown) => void;
  onPlanDelta: (delta: string) => void;
  onAnswerDelta: (delta: string) => void;
  onTruncated: () => void;
  // feature 016 (FR-003): one entry per phase call; the caller fills
  // personaName and gates on the outputPanel setting
  onMetric?: (e: Omit<MetricEntry, "id" | "ts" | "personaName">) => void;
  // feature 015 (FR-009): the executor's answer phase runs through the
  // tool loop; the planner's output is never scanned for calls
  tools?: {
    service: ToolService;
    messageId: string;
    onCall: (call: ToolCallRecord) => void;
    onBudgetWarning: () => void;
    isStopped: () => boolean;
  };
}

export interface FusionTurnResult {
  status: "complete" | "partial";
  plan?: {
    content: string;
    stats?: MessageStats | null;
    tag: string;
    fileName: string;
    servedBy: "primary" | "fallback";
  };
  answer?: {
    stats?: MessageStats | null;
    tag: string;
    fileName: string;
    servedBy: "primary" | "fallback";
  };
}

const isCtxOverflow = (e: unknown) =>
  e instanceof Error && e.message.includes("context window");

const toStats = (r: { tokens: number; elapsedMs: number }): MessageStats | null =>
  r.tokens > 0
    ? {
        tokens: r.tokens,
        tokensPerSec: Math.round((r.tokens / (r.elapsedMs / 1000)) * 10) / 10,
      }
    : null;

// One budgeted phase generate — mirrors the single-mode retry loop:
// halve the history budget on real context overflow, stop at 256.
async function genPhase(opts: {
  eng: SlotEngine;
  params: GenerationParams;
  conversationId: string;
  roleKey?: string; // feature 010
  snapshot?: SnapshotStore; // feature 010
  history: PromptTurn[];
  current: string;
  system?: string;
  onToken: (delta: string) => void;
  onTruncated: () => void;
  // feature 016: promptTokens/warm forwarded from the engine result
}): Promise<{
  status: "complete" | "partial";
  tokens: number;
  elapsedMs: number;
  warm?: boolean;
  promptTokens?: number;
}> {
  const ctxSize = opts.eng.contextSize();
  const reserve = Math.min(512, Math.floor(ctxSize / 2) || 512);
  const baseBudget = ctxSize > 0 ? ctxSize - reserve : Infinity;
  const chatml = (opts.eng.chatTemplate() ?? "").includes("im_start");
  const costOf = (t: { content: string }) => opts.eng.tokenCount(t.content) + 8;
  let budget = baseBudget;
  for (;;) {
    const built = buildPrompt(opts.history, opts.current, {
      chatml,
      budget,
      costOf,
      system: opts.system,
    });
    if (built.truncated) opts.onTruncated();
    try {
      // oxlint-disable-next-line no-await-in-loop -- sequential budget-halving retry
      return await opts.eng.generate(built.prompt, opts.onToken, opts.params, {
        conversationId: opts.conversationId,
        roleKey: opts.roleKey,
        snapshot: opts.snapshot,
      });
    } catch (e) {
      if (!isCtxOverflow(e) || budget <= 256) throw e;
      budget = Math.floor(budget / 2);
    }
  }
}

// feature 015 (FR-009): the executor's answer phase — identical budgeting
// to genPhase, but generation runs inside the tool loop so structured
// calls can pause, resolve, and continue on the same KV prefix.
async function genToolPhase(opts: {
  eng: SlotEngine;
  params: GenerationParams;
  conversationId: string;
  roleKey?: string;
  snapshot?: SnapshotStore;
  history: PromptTurn[];
  current: string;
  system?: string;
  tools: NonNullable<FusionTurnOpts["tools"]>;
  onToken: (delta: string) => void;
  onTruncated: () => void;
}): Promise<{
  status: "complete" | "partial";
  tokens: number;
  elapsedMs: number;
  warm: boolean;
  promptTokens: number;
}> {
  const ctxSize = opts.eng.contextSize();
  const reserve = Math.min(512, Math.floor(ctxSize / 2) || 512);
  const baseBudget = ctxSize > 0 ? ctxSize - reserve : Infinity;
  const chatml = (opts.eng.chatTemplate() ?? "").includes("im_start");
  const costOf = (t: { content: string }) => opts.eng.tokenCount(t.content) + 8;
  let budget = baseBudget;
  for (;;) {
    const built = buildPrompt(opts.history, opts.current, {
      chatml,
      budget,
      costOf,
      system: opts.system,
    });
    if (built.truncated) opts.onTruncated();
    try {
      // oxlint-disable-next-line no-await-in-loop -- sequential budget-halving retry
      return await runToolLoop(opts.eng, built.prompt, {
        tools: opts.tools.service,
        conversationId: opts.conversationId,
        messageId: opts.tools.messageId,
        genParams: opts.params,
        genOpts: {
          conversationId: opts.conversationId,
          roleKey: opts.roleKey,
          snapshot: opts.snapshot,
        },
        onDelta: opts.onToken,
        onCall: opts.tools.onCall,
        onBudgetWarning: opts.tools.onBudgetWarning,
        isStopped: opts.tools.isStopped,
      });
    } catch (e) {
      if (!isCtxOverflow(e) || budget <= 256) throw e;
      budget = Math.floor(budget / 2);
    }
  }
}

const phaseEvent = (phase: FusionPhase, role: ResolvedRole) => ({
  phase,
  tag: role.tag,
  fileName: role.fileName,
  servedBy: role.servedBy.kind,
});

export async function runFusionTurn(
  o: FusionTurnOpts,
): Promise<FusionTurnResult> {
  // One phase over an ordered candidate list (T019 runtime cascade):
  // retry the next candidate when a slot fails to load or generation
  // fails before the first token; once tokens flow, errors propagate.
  const runPhase = async (
    kind: "planner" | "executor",
    cands: ResolvedRole[],
    history: PromptTurn[],
    current: string,
    onDelta: (d: string) => void,
    phase: FusionPhase,
    system?: string,
  ): Promise<{
    role: ResolvedRole;
    res: {
      status: "complete" | "partial";
      tokens: number;
      elapsedMs: number;
      warm?: boolean;
      promptTokens?: number;
    };
    content: string;
  }> => {
    // feature 016: preview is the phase's request text, one line, <=120 chars
    const promptPreview = current.replace(/\s+/g, " ").slice(0, 120);
    let lastErr: unknown = new Error(`${kind} role unbound`);
    for (const role of cands) {
      let slot;
      let emitted = false;
      let content = "";
      const t0 = performance.now();
      try {
        // oxlint-disable-next-line no-await-in-loop -- sequential candidate cascade
        slot = await o.registry.acquire(role.path);
        o.registry.pin(slot.path, o.conversationId);
        o.onEvent("chat.phase", phaseEvent(phase, role));
        const onTok = (d: string) => {
          emitted = true;
          content += d;
          onDelta(d);
          o.onEvent("chat.token", { delta: d, phase });
        };
        // oxlint-disable-next-line no-await-in-loop -- sequential candidate cascade
        const res = await (kind === "executor" && o.tools
          ? genToolPhase({
              eng: slot.engine,
              params: role.params,
              conversationId: o.conversationId,
              roleKey: kind,
              snapshot: o.snapshot,
              history,
              current,
              system,
              tools: o.tools,
              onToken: onTok,
              onTruncated: o.onTruncated,
            })
          : genPhase({
              eng: slot.engine,
              params: role.params,
              conversationId: o.conversationId,
              roleKey: kind,
              snapshot: o.snapshot,
              history,
              current,
              system,
              onToken: onTok,
              onTruncated: o.onTruncated,
            }));
        o.onMetric?.({
          conversationId: o.conversationId,
          modelFile: role.fileName,
          roleKey: kind,
          tag: role.tag,
          promptTokens: res.promptTokens ?? 0,
          outputTokens: res.tokens,
          elapsedMs: res.elapsedMs,
          warm: res.warm ?? false,
          status: res.status,
          fallback: role.servedBy.kind === "fallback" || undefined,
          promptPreview,
        });
        return { role, res, content };
      } catch (e) {
        lastErr = e;
        // feature 016: a failed phase call is still a call — record it
        o.onMetric?.({
          conversationId: o.conversationId,
          modelFile: role.fileName,
          roleKey: kind,
          tag: role.tag,
          promptTokens: 0,
          outputTokens:
            content && slot ? slot.engine.tokenCount(content) : 0,
          elapsedMs: Math.round(performance.now() - t0),
          warm: false,
          status: "failed",
          fallback: role.servedBy.kind === "fallback" || undefined,
          promptPreview,
        });
        if (emitted) throw e; // mid-stream failure: retrying duplicates output
        // fall through to next candidate
      } finally {
        if (slot) o.registry.release(slot.path);
      }
    }
    throw lastErr;
  };

  // ---- plan phase ----
  const p = await runPhase(
    "planner",
    o.planner,
    [], // planner sees a fresh planning request (D5)
    buildPlannerPrompt(o.plannerText ?? o.current),
    o.onPlanDelta,
    "plan",
  );
  const plan = {
    content: p.content,
    stats: toStats(p.res),
    tag: p.role.tag,
    fileName: p.role.fileName,
    servedBy: p.role.servedBy.kind,
  };
  // stop-at-boundary: a stopped/failed plan phase ends the turn partial —
  // the answer phase never runs on an aborted plan
  if (p.res.status !== "complete") {
    return { status: "partial", plan };
  }

  // ---- answer phase ----
  const a = await runPhase(
    "executor",
    o.executor,
    o.history,
    buildExecutorPrompt(o.current, p.content),
    o.onAnswerDelta,
    "answer",
    o.executorSystem,
  );
  return {
    status: a.res.status,
    plan,
    answer: {
      stats: toStats(a.res),
      tag: a.role.tag,
      fileName: a.role.fileName,
      servedBy: a.role.servedBy.kind,
    },
  };
}
