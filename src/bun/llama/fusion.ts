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
  planner: ResolvedRole;
  executor: ResolvedRole;
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
  };
  answer?: {
    stats?: MessageStats | null;
    tag: string;
    fileName: string;
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
  // ---- plan phase ----
  const pSlot = await o.registry.acquire(o.planner.path);
  o.registry.pin(pSlot.path, o.conversationId);
  let planRes: { status: "complete" | "partial"; tokens: number; elapsedMs: number };
  let planContent = "";
  try {
    o.onEvent("chat.phase", phaseEvent("plan", o.planner));
    planRes = await genPhase({
      eng: pSlot.engine,
      params: o.planner.params,
      conversationId: o.conversationId,
      history: [], // planner sees a fresh planning request (D5)
      current: buildPlannerPrompt(o.current),
      onToken: (d) => {
        planContent += d;
        o.onPlanDelta(d);
        o.onEvent("chat.token", { delta: d, phase: "plan" });
      },
      onTruncated: o.onTruncated,
    });
  } finally {
    o.registry.release(pSlot.path);
  }
  const plan = {
    content: planContent,
    stats: toStats(planRes),
    tag: o.planner.tag,
    fileName: o.planner.fileName,
  };
  // stop-at-boundary: a stopped/failed plan phase ends the turn partial —
  // the answer phase never runs on an aborted plan
  if (planRes.status !== "complete") {
    return { status: "partial", plan };
  }

  // ---- answer phase ----
  const eSlot = await o.registry.acquire(o.executor.path);
  o.registry.pin(eSlot.path, o.conversationId);
  let ansRes: typeof planRes;
  try {
    o.onEvent("chat.phase", phaseEvent("answer", o.executor));
    ansRes = await genPhase({
      eng: eSlot.engine,
      params: o.executor.params,
      conversationId: o.conversationId,
      history: o.history,
      current: buildExecutorPrompt(o.current, planContent),
      onToken: (d) => {
        o.onAnswerDelta(d);
        o.onEvent("chat.token", { delta: d, phase: "answer" });
      },
      onTruncated: o.onTruncated,
    });
  } finally {
    o.registry.release(eSlot.path);
  }
  return {
    status: ansRes.status,
    plan,
    answer: {
      stats: toStats(ansRes),
      tag: o.executor.tag,
      fileName: o.executor.fileName,
    },
  };
}
