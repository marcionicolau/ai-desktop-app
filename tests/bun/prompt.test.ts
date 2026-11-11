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
