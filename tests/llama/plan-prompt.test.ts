// Planner/executor prompt builders (T014): directive shape, <plan>
// injection ordering, no-history contract.
import { describe, expect, test } from "bun:test";
import { buildExecutorPrompt, buildPlannerPrompt } from "../../src/bun/llama/plan-prompt";

describe("plan-prompt", () => {
  test("planner prompt carries directive + user text, no answer", () => {
    const p = buildPlannerPrompt("write a haiku");
    expect(p).toContain("planning model");
    expect(p).toContain("User request: write a haiku");
    expect(p).not.toContain("<plan>");
  });

  test("executor prompt injects <plan> before the request", () => {
    const p = buildExecutorPrompt("write a haiku", "1. pick a topic\n2. rhyme");
    const planIdx = p.indexOf("<plan>");
    const reqIdx = p.indexOf("answer this request: write a haiku");
    expect(planIdx).toBeGreaterThan(-1);
    expect(reqIdx).toBeGreaterThan(planIdx);
    expect(p).toContain("1. pick a topic");
    expect(p).toContain("</plan>");
  });
});
