// feature 017 (T031a): DAG executor — input binding ($objective/$params/
// step refs), topological order, trace emission, abort awareness.
import { describe, expect, test } from "bun:test";
import { executePipeline } from "../../src/bun/fabric/pipeline";
import type { RunCtx } from "../../src/bun/fabric/components";
import type { SkillContrib } from "../../src/bun/fabric/registry";
import type { SkillView, TraceEntry } from "../../src/shared/types";

const view = (name: string, over: Partial<SkillView> = {}): SkillView => ({
  id: `p:${name}`,
  packId: "p",
  name,
  version: "1.0.0",
  runtime: "component:const",
  description: "",
  inputs: {},
  outputs: {},
  params: {},
  guidance: {},
  ...over,
});

const constSkill = (name: string, value: unknown): SkillContrib => ({
  view: view(name, {
    params: { value: { default: value } },
    outputs: { value: { type: "any" } },
  }),
  file: `${name}/SKILL.md`,
});

const pipeline = (steps: SkillContrib["steps"], outputs: SkillView["outputs"] = {}): SkillContrib => ({
  view: view("pl", { outputs }),
  file: "pl/SKILL.md",
  steps,
});

const ctx = (skills: Map<string, SkillContrib>, signal?: AbortSignal): RunCtx => ({
  engine: { generate: async () => ({ status: "complete" as const, tokens: 0 }), tokenCount: () => 0 },
  resolveSkill: (ref) => skills.get(ref) ?? null,
  runPipeline: async (pl, inputs, params, path) =>
    executePipeline(pl, inputs, params, "", { ...ctx(skills, signal), path }),
  signal,
  path: "p:pl",
});

describe("executePipeline", () => {
  test("steps run in order; step refs and $objective/$params bind", async () => {
    const skills = new Map<string, SkillContrib>([
      ["p:echo", {
        view: view("echo", {
          runtime: "component:text.concat",
          inputs: { parts: { type: "any" } },
          params: { separator: { default: "|" } },
          outputs: { text: { type: "text" } },
        }),
        file: "echo/SKILL.md",
      }],
    ]);
    const pl = pipeline(
      [
        { id: "one", uses: "echo", inputs: { parts: "$objective" } },
        { id: "two", uses: "echo", inputs: { parts: "$params.extra" } },
      ],
      { text: { type: "text" } },
    );
    const trace: Omit<TraceEntry, "seq">[] = [];
    const out = await executePipeline(
      pl,
      { extra: ["b"] },
      { extra: ["b"] },
      "a",
      ctx(skills),
      { trace: (e) => trace.push(e) },
    );
    expect(out.text).toBe("b");
    expect(trace.map((t) => t.stepId)).toEqual(["one", "one", "two", "two"]);
    expect(trace[0].status).toBe("running");
    expect(trace[1].status).toBe("completed");
  });

  test("ref to absent producing step → CONTRACT_VIOLATION at run time", async () => {
    const pl = pipeline([{ id: "s", uses: "p:echo", inputs: { parts: "ghost.out" } }]);
    await expect(
      executePipeline(pl, {}, {}, "", ctx(new Map())),
    ).rejects.toThrowError();
  });

  test("abort signal mid-run → cancelled error", async () => {
    const c = new AbortController();
    c.abort();
    const pl = pipeline([{ id: "s", uses: "p:echo" }]);
    await expect(
      executePipeline(pl, {}, {}, "", ctx(new Map(), c.signal)),
    ).rejects.toThrowError(/cancelled/);
  });
});
