// feature 017 (T031b): agent-tree runner — llm leaf calls, sequential
// chaining, router plan validation + @refs, depth/budget enforcement.
import { describe, expect, test } from "bun:test";
import { runAgent, type AgentRunOpts } from "../../src/bun/fabric/agent";
import type { ComponentEngine, RunCtx } from "../../src/bun/fabric/components";
import type { AgentContrib, ContributionRegistry } from "../../src/bun/fabric/registry";
import type { AgentView } from "../../src/shared/types";
import type { AgentFrontmatter } from "../../src/shared/pack-schema";

const view = (name: string, kind: AgentView["kind"], children: AgentView[] = []): AgentView => ({
  id: `p:${name}`,
  packId: "p",
  name,
  kind,
  children,
});

const agent = (
  name: string,
  fm: Partial<AgentFrontmatter>,
  body = "sys",
): AgentContrib => ({
  view: view(name, fm.kind ?? "llm"),
  file: `${name}/AGENT.md`,
  body,
  fm: { name, kind: "llm", ...fm } as AgentFrontmatter,
});

const engine = (answer: string): ComponentEngine => ({
  tokenCount: (t) => t.length,
  generate: async (_p, onToken) => {
    onToken(answer);
    return { status: "complete", tokens: 3, promptTokens: 1 };
  },
});

const ctx = (eng: ComponentEngine): RunCtx => ({
  engine: eng,
  resolveSkill: () => null,
  runPipeline: async () => ({}),
  path: "p",
});

const opts = (objective = "obj"): AgentRunOpts => ({
  objective,
  params: {},
  budget: { maxDepth: 4 },
});

const regOf = (agents: AgentContrib[]): ContributionRegistry =>
  ({
    lookupAgentContrib: (id: string) => agents.find((a) => a.view.id === id) ?? null,
  }) as unknown as ContributionRegistry;

describe("runAgent", () => {
  test("llm leaf: body + objective → engine, returns {text}", async () => {
    const a = agent("leaf", { kind: "llm" }, "You are terse.");
    const prompts: string[] = [];
    const eng: ComponentEngine = {
      tokenCount: (t) => t.length,
      generate: async (p, onToken) => {
        prompts.push(p);
        onToken("done");
        return { status: "complete", tokens: 1 };
      },
    };
    const out = await runAgent(a, opts("summarize this"), ctx(eng), regOf([]));
    expect(out).toEqual({ text: "done" });
    expect(prompts[0]).toContain("You are terse.");
    expect(prompts[0]).toContain("summarize this");
  });

  test("sequential chains children, feeding prior output", async () => {
    const kid = agent("kid", { kind: "llm" });
    kid.view.children = [];
    const parent = agent("parent", { kind: "sequential", children: ["kid"] });
    const out = await runAgent(parent, opts(), ctx(engine("step1")), regOf([kid]));
    expect(out).toEqual({ text: "step1" });
  });

  test("router: model plan → delegation in order; @ref interpolates result", async () => {
    const worker = agent("worker", { kind: "llm" });
    const router = agent("lead", { kind: "router", children: ["worker"] });
    const calls: string[] = [];
    const eng: ComponentEngine = {
      tokenCount: (t) => t.length,
      generate: async (p, onToken) => {
        calls.push(p);
        if (calls.length === 1) onToken('[{"agent":"worker","objective":"do it","id":"d1"}]');
        else onToken("worked");
        return { status: "complete", tokens: 2 };
      },
    };
    const out = await runAgent(router, opts("big task"), ctx(eng), regOf([worker]));
    expect(out).toEqual({ text: "worked" });
    expect(calls[1]).toContain("do it");
  });

  test("router plan naming an unknown child → CONTRACT_VIOLATION", async () => {
    const router = agent("lead", { kind: "router", children: ["worker"] });
    const eng = engine('[{"agent":"ghost","objective":"x"}]');
    await expect(
      runAgent(router, opts(), ctx(eng), regOf([agent("worker", { kind: "llm" })])),
    ).rejects.toThrowError(/unknown child|CONTRACT/i);
  });

  test("maxDepth exceeded → located error", async () => {
    const a = agent("deep", { kind: "llm" });
    await expect(
      runAgent(a, { ...opts(), depth: 99 }, ctx(engine("x")), regOf([])),
    ).rejects.toThrowError(/max agent depth/);
  });
});
