// feature 017 (T027): builtin components' port behavior + runtime:prompt
// template rendering and declared-output validation over a fake engine.
import { describe, expect, test } from "bun:test";
import {
  renderTemplate,
  runBuiltin,
  runSkill,
  validateOutputs,
  type ComponentEngine,
  type RunCtx,
} from "../../src/bun/fabric/components";
import type { SkillContrib } from "../../src/bun/fabric/registry";
import type { SkillView } from "../../src/shared/types";

const view = (over: Partial<SkillView> = {}): SkillView => ({
  id: "p:s",
  packId: "p",
  name: "s",
  version: "1.0.0",
  runtime: "prompt",
  description: "",
  inputs: {},
  outputs: {},
  params: {},
  guidance: {},
  ...over,
});

const skill = (over: Partial<SkillContrib> = {}, v: Partial<SkillView> = {}): SkillContrib => ({
  view: view(v),
  file: "s/SKILL.md",
  ...over,
});

const fakeEngine = (answer: string): ComponentEngine => ({
  tokenCount: (t) => t.length,
  generate: async (_p, onToken) => {
    onToken(answer);
    return { status: "complete", tokens: 4, promptTokens: 9 };
  },
});

const ctx = (engine = fakeEngine("{}")): RunCtx => ({
  engine,
  resolveSkill: () => null,
  runPipeline: async () => ({}),
  path: "p:s",
});

describe("builtins", () => {
  test("const / text.concat / text.template", () => {
    expect(runBuiltin("const", {}, { value: 7 }, "p")).toEqual({ value: 7 });
    expect(runBuiltin("text.concat", { parts: ["a", "b"] }, { separator: "-" }, "p")).toEqual({ text: "a-b" });
    expect(runBuiltin("text.template", { name: "x" }, { template: "hi {name}" }, "p")).toEqual({ text: "hi x" });
  });

  test("json.extract / list.map / list.filter", () => {
    expect(runBuiltin("json.extract", { doc: { a: { b: 3 } } }, { path: "a.b" }, "p")).toEqual({ value: 3 });
    expect(runBuiltin("list.map", { items: [{ n: 1 }, { n: 2 }] }, { pick: "n" }, "p")).toEqual({ items: [1, 2] });
    expect(runBuiltin("list.filter", { items: [{ ok: true }, { ok: false }] }, { pick: "ok" }, "p")).toEqual({ items: [{ ok: true }] });
  });

  test("unknown builtin → CONTRACT_VIOLATION", () => {
    expect(() => runBuiltin("nope", {}, {}, "p")).toThrowError(/unknown builtin/);
  });
});

describe("prompt component", () => {
  test("renderTemplate expands params/inputs/objective", () => {
    const out = renderTemplate("{params.tone} {inputs.t} {objective} {{x}}", {
      params: { tone: "warm" },
      inputs: { t: "T" },
      objective: "OBJ",
    });
    expect(out).toBe("warm T OBJ {x}");
  });

  test("declared outputs parsed from model JSON and validated", async () => {
    const s = skill(
      { instructions: "Say {params.tone} about {inputs.transcript}" },
      {
        inputs: { transcript: { type: "text" } },
        outputs: { summary: { type: "text" } },
        params: { tone: { default: "neutral" } },
      },
    );
    const seen: string[] = [];
    const eng: ComponentEngine = {
      tokenCount: (t) => t.length,
      generate: async (prompt, onToken) => {
        seen.push(prompt);
        onToken('{"summary":"short"}');
        return { status: "complete", tokens: 2 };
      },
    };
    const out = await runSkill(s, { transcript: "the notes" }, {}, "obj", ctx(eng));
    expect(out).toEqual({ summary: "short" });
    expect(seen[0]).toContain("neutral about the notes");
  });

  test("non-JSON output for declared ports → located error", async () => {
    const s = skill({}, { outputs: { summary: { type: "text" } } });
    await expect(
      runSkill(s, {}, {}, "o", ctx(fakeEngine("not json"))),
    ).rejects.toThrowError(/non-JSON/);
  });

  test("missing required input port → located error", async () => {
    const s = skill({}, { inputs: { t: { type: "text" } } });
    await expect(runSkill(s, {}, {}, "o", ctx())).rejects.toThrowError(/input "t"/);
  });

  test("validateOutputs type-checks ports", () => {
    expect(() =>
      validateOutputs({ n: { type: "number" } }, { n: "x" }, "p"),
    ).toThrowError(/expected number/);
    expect(validateOutputs({ l: { type: "list" } }, { l: [1] }, "p")).toEqual({ l: [1] });
  });
});
