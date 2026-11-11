// FusionOrchestrator (research D4): sequential two-phase turn —
// planner -> executor — as a small state machine. Each phase is a normal
// budgeted generate on its own resolved slot; the registry shares slots
// when both roles bind the same file (FR-011). Single-flight semantics
// are unchanged: the whole turn is one run under the ENGINE_BUSY gate.
import type {
  FusionPhase,
  GenerationParams,
  MessageStats,
  ResolvedRole,
} from "../../shared/types";
import type { ModelRegistry, SlotEngine } from "../models/registry";
import { buildExecutorPrompt, buildPlannerPrompt } from "./plan-prompt";
import { buildPrompt, type PromptTurn } from "./prompt";

export interface FusionTurnOpts {
  // ordered candidates per role (T019): load/pre-token failures walk
  // the list; servedBy on the winner is emitted in chat.phase
  planner: ResolvedRole[];
  executor: ResolvedRole[];
  registry: ModelRegistry;
  conversationId: string;
  history: PromptTurn[]; // newest-first, same convention as chat path
  current: string; // the user's message text
  // events are re-emitted by the caller with messageId filled in
  onEvent: (method: "chat.phase" | "chat.token", payload: unknown) => void;
  onPlanDelta: (delta: string) => void;
  onAnswerDelta: (delta: string) => void;
  onTruncated: () => void;
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
  history: PromptTurn[];
  current: string;
  onToken: (delta: string) => void;
  onTruncated: () => void;
}): Promise<{ status: "complete" | "partial"; tokens: number; elapsedMs: number }> {
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
    });
    if (built.truncated) opts.onTruncated();
    try {
      // oxlint-disable-next-line no-await-in-loop -- sequential budget-halving retry
      return await opts.eng.generate(built.prompt, opts.onToken, opts.params, {
        conversationId: opts.conversationId,
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
  ): Promise<{
    role: ResolvedRole;
    res: { status: "complete" | "partial"; tokens: number; elapsedMs: number };
    content: string;
  }> => {
    let lastErr: unknown = new Error(`${kind} role unbound`);
    for (const role of cands) {
      let slot;
      let emitted = false;
      let content = "";
      try {
        // oxlint-disable-next-line no-await-in-loop -- sequential candidate cascade
        slot = await o.registry.acquire(role.path);
        o.registry.pin(slot.path, o.conversationId);
        o.onEvent("chat.phase", phaseEvent(phase, role));
        // oxlint-disable-next-line no-await-in-loop -- sequential candidate cascade
        const res = await genPhase({
          eng: slot.engine,
          params: role.params,
          conversationId: o.conversationId,
          history,
          current,
          onToken: (d) => {
            emitted = true;
            content += d;
            onDelta(d);
            o.onEvent("chat.token", { delta: d, phase });
          },
          onTruncated: o.onTruncated,
        });
        return { role, res, content };
      } catch (e) {
        lastErr = e;
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
    buildPlannerPrompt(o.current),
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
