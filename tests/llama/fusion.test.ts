// FusionOrchestrator (T015): two-phase order, plan injection, per-role
// params, shared slot for same-path roles, stop-at-boundary.
import { describe, expect, test } from "bun:test";
import { ModelRegistry, type SlotEngine } from "../../src/bun/models/registry";
import { runFusionTurn } from "../../src/bun/llama/fusion";
import type { ResolvedRole } from "../../src/shared/types";
import { DEFAULT_GENERATION } from "../../src/shared/types";

function fakeEngine(tokens: string[], stopAfter = -1): SlotEngine & { calls: { prompt: string; params: unknown }[] } {
  const calls: { prompt: string; params: unknown }[] = [];
  let generating = false;
  const eng = {
    calls,
    status: () => ({ status: "ready" as const, name: "f" }),
    loadModel: async (path: string) => ({ status: "ready" as const, name: path }),
    unloadModel: () => {},
    isGenerating: () => generating,
    contextSize: () => 4096,
    chatTemplate: () => null,
    tokenCount: (t: string) => Math.ceil(t.length / 4),
    stop: () => {},
    dispose: () => {},
    generate: async (
      prompt: string,
      onToken: (d: string) => void,
      params?: unknown,
    ) => {
      calls.push({ prompt, params });
      generating = true;
      let i = 0;
      for (const t of tokens) {
        if (stopAfter === i++) break;
        onToken(t);
        await new Promise((r) => setTimeout(r, 0));
      }
      generating = false;
      return {
        status: stopAfter >= 0 && stopAfter < tokens.length ? ("partial" as const) : ("complete" as const),
        tokens: tokens.length,
        elapsedMs: 10,
        warm: false,
      };
    },
  };
  return eng as unknown as SlotEngine & { calls: { prompt: string; params: unknown }[] };
}

const role = (tag: string, fileName: string): ResolvedRole => ({
  tag,
  fileName,
  path: `/m/${fileName}`,
  params: { ...DEFAULT_GENERATION, temperature: tag === "planner" ? 0.1 : 0.8 },
  servedBy: { kind: "primary" },
});

function registryWith(engines: (SlotEngine & { calls: { prompt: string }[] })[]) {
  let i = 0;
  return new ModelRegistry(10, () => engines[i++]!);
}

const baseOpts = {
  planner: [role("planner", "plan.gguf")],
  executor: [role("executor", "exec.gguf")],
  conversationId: "c1",
  history: [],
  current: "write a poem",
  onTruncated: () => {},
};

describe("runFusionTurn", () => {
  test("emits plan phase -> tokens -> answer phase -> tokens; plan injected", async () => {
    const events: { m: string; phase?: string }[] = [];
    const deltas = { plan: "", answer: "" };
    const pEng = fakeEngine(["PLAN1", "PLAN2"]);
    const eEng = fakeEngine(["ANS1"]);
    const reg = registryWith([pEng, eEng]);
    const res = await runFusionTurn({
      ...baseOpts,
      registry: reg,
      onEvent: (m, p) => events.push({ m, phase: (p as { phase?: string }).phase }),
      onPlanDelta: (d) => (deltas.plan += d),
      onAnswerDelta: (d) => (deltas.answer += d),
    });
    expect(res.status).toBe("complete");
    expect(deltas.plan).toBe("PLAN1PLAN2");
    expect(deltas.answer).toBe("ANS1");
    expect(events.map((e) => `${e.m}:${e.phase ?? ""}`)).toEqual([
      "chat.phase:plan",
      "chat.token:plan",
      "chat.token:plan",
      "chat.phase:answer",
      "chat.token:answer",
    ]);
    expect(eEng.calls[0]!.prompt).toContain("<plan>");
    expect(eEng.calls[0]!.prompt).toContain("PLAN1PLAN2");
    expect(eEng.calls[0]!.prompt).toContain("write a poem");
    expect((pEng.calls[0]!.params as { temperature: number }).temperature).toBe(0.1);
    expect((eEng.calls[0]!.params as { temperature: number }).temperature).toBe(0.8);
  });

  test("roles on the same file share one slot", async () => {
    const reg = registryWith([fakeEngine(["x"])]);
    const events: unknown[] = [];
    await runFusionTurn({
      ...baseOpts,
      planner: [role("planner", "same.gguf")],
      executor: [role("executor", "same.gguf")],
      registry: reg,
      onEvent: (m, p) => events.push(p),
      onPlanDelta: () => {},
      onAnswerDelta: () => {},
    });
    expect(reg.size()).toBe(1);
  });

  test("partial plan stops before the answer phase", async () => {
    const pEng = fakeEngine(["A", "B"], 1); // stops after 1 token
    const eEng = fakeEngine(["NEVER"]);
    const reg = registryWith([pEng, eEng]);
    const phases: string[] = [];
    const res = await runFusionTurn({
      ...baseOpts,
      registry: reg,
      onEvent: (m, p) => {
        if (m === "chat.phase") phases.push((p as { phase: string }).phase);
      },
      onPlanDelta: () => {},
      onAnswerDelta: () => {},
    });
    expect(res.status).toBe("partial");
    expect(res.plan?.content).toBe("A");
    expect(res.answer).toBeUndefined();
    expect(phases).toEqual(["plan"]);
    expect(eEng.calls).toHaveLength(0);
  });

  test("primary load failure falls back to the next candidate", async () => {
    const bad = fakeEngine(["BAD"]);
    bad.loadModel = async () => {
      throw new Error("corrupt gguf");
    };
    const good = fakeEngine(["PLAN"]);
    const exec = fakeEngine(["ANS"]);
    const engines = [bad, good, exec];
    let i = 0;
    const reg = new ModelRegistry(10, () => engines[i++]!);
    const res = await runFusionTurn({
      ...baseOpts,
      planner: [
        role("planner", "bad.gguf"),
        {
          ...role("planner", "plan.gguf"),
          servedBy: { kind: "fallback", via: { kind: "model", fileName: "plan.gguf" } },
        },
      ],
      registry: reg,
      onEvent: () => {},
      onPlanDelta: () => {},
      onAnswerDelta: () => {},
    });
    expect(res.status).toBe("complete");
    expect(res.plan?.content).toBe("PLAN");
    expect(res.plan?.servedBy).toBe("fallback");
  });

  test("mid-stream failure does NOT retry the next candidate", async () => {
    const flaky = fakeEngine(["A", "B"]);
    flaky.generate = async (_p: string, onToken: (d: string) => void) => {
      onToken("A");
      throw new Error("boom mid-stream");
    };
    const next = fakeEngine(["NEVER"]);
    const engines = [flaky, next];
    let i = 0;
    const reg = new ModelRegistry(10, () => engines[i++]!);
    await expect(
      runFusionTurn({
        ...baseOpts,
        planner: [role("planner", "a.gguf"), role("planner", "b.gguf")],
        registry: reg,
        onEvent: () => {},
        onPlanDelta: () => {},
        onAnswerDelta: () => {},
      }),
    ).rejects.toThrow("boom mid-stream");
    expect(next.calls).toHaveLength(0);
  });
});
