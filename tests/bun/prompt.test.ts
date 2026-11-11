// Pure prompt assembly: plain/ChatML formatting, oldest-turn drop under
// budget, current message always kept, custom costOf (token budgeting).
import { describe, expect, test } from "bun:test";
import { buildPrompt } from "../../src/bun/llama/prompt";

const turn = (role: "user" | "assistant", content: string) => ({
  role,
  content,
});

describe("buildPrompt", () => {
  test("plain format renders turns oldest-first with assistant opener", () => {
    const r = buildPrompt(
      [turn("assistant", "hi there"), turn("user", "hello")],
      "next",
      { chatml: false, budget: 10000 },
    );
    expect(r.prompt).toBe("User: hello\nAssistant: hi there\nUser: next\nAssistant: ");
    expect(r.truncated).toBe(false);
    expect(r.turns).toHaveLength(3);
  });

  test("chatml format wraps each turn in special tokens", () => {
    const r = buildPrompt([turn("user", "hello")], "next", {
      chatml: true,
      budget: 10000,
    });
    expect(r.prompt).toContain("im_start");
    expect(r.prompt).toContain("user\nhello");
    expect(r.prompt.endsWith("assistant\n")).toBe(true);
  });

  test("drops oldest turns over budget; current message always kept", () => {
    const history = [
      turn("assistant", "newest"),
      turn("user", "middle"),
      turn("assistant", "oldest"),
    ];
    const r = buildPrompt(history, "now", {
      chatml: false,
      budget: 60, // current(3+32=35) + newest(6+32=38)=73>60 -> only current+? fits
    });
    expect(r.truncated).toBe(true);
    expect(r.turns.at(-1)!.content).toBe("now");
    expect(r.prompt).not.toContain("oldest");
  });

  test("custom costOf drives the budget (token counting)", () => {
    const history = [turn("assistant", "x".repeat(100))];
    const r = buildPrompt(history, "hi", {
      chatml: false,
      budget: 50,
      costOf: (t) => Math.ceil(t.content.length / 4) + 8,
    });
    // current: 1+8=9; history: 25+8=33; 9+33=42 <= 50 -> fits
    expect(r.truncated).toBe(false);
    const r2 = buildPrompt(history, "hi", {
      chatml: false,
      budget: 30,
      costOf: (t) => Math.ceil(t.content.length / 4) + 8,
    });
    expect(r2.truncated).toBe(true);
  });
});

// feature 006: persona system turn — always kept, budgeted before history
describe("system turn (feature 006)", () => {
  test("system is kept first, ahead of history, when budget is tight", () => {
    const history = [turn("assistant", "h1"), turn("user", "h2")];
    const r = buildPrompt(history, "now", {
      chatml: false,
      budget: 80, // system+current fit (75); each history turn adds 34 → dropped
      system: "steer me",
    });
    expect(r.turns[0]).toEqual({ role: "system", content: "steer me" });
    expect(r.truncated).toBe(true); // history dropped to keep system
    expect(r.prompt).toContain("System: steer me");
  });

  test("system alone over budget is hard-truncated + flagged", () => {
    const r = buildPrompt([], "hi", {
      chatml: true,
      budget: 50,
      system: "x".repeat(200),
    });
    expect(r.truncated).toBe(true);
    expect(r.turns[0].content.length).toBeLessThan(200);
  });

  test("chatml renders a system im_start block", () => {
    const r = buildPrompt([], "hi", {
      chatml: true,
      budget: 500,
      system: "be terse",
    });
    expect(r.prompt).toContain("|im_start|>system\nbe terse");
    expect(r.prompt).not.toContain("System: be terse");
  });

  test("plain render labels system distinctly from user/assistant", () => {
    const r = buildPrompt(
      [turn("assistant", "a1")],
      "u1",
      { chatml: false, budget: 500, system: "sys" },
    );
    expect(r.prompt.startsWith("System: sys\n")).toBe(true);
    expect(r.prompt).toContain("Assistant: a1");
  });
});
