// feature 018 (T005): startup-prompt trigger predicate — hydration gate
// (U1), fire-once latch (U2), loading suppression (FR-006).
import { describe, expect, test } from "bun:test";
import { decideStartupPrompt } from "../../src/renderer/src/features/chat/startup-prompt";

const d = (hydrated: boolean, evaluated: boolean, status: "unloaded" | "loading" | "ready" | "error") =>
  decideStartupPrompt({ hydrated, evaluated, status });

describe("decideStartupPrompt", () => {
  test("pre-hydration unloaded → wait (U1: no prompt flash on boot)", () => {
    expect(d(false, false, "unloaded")).toBe("wait");
  });
  test("hydrated unloaded → open (FR-001)", () => {
    expect(d(true, false, "unloaded")).toBe("open");
  });
  test("hydrated error → open (FR-007: unusable default)", () => {
    expect(d(true, false, "error")).toBe("open");
  });
  test("loading → wait (FR-006)", () => {
    expect(d(true, false, "loading")).toBe("wait");
  });
  test("ready → settle, no prompt (FR-003)", () => {
    expect(d(true, false, "ready")).toBe("settle");
  });
  test("already evaluated → wait (fire-once / FR-004 dismissal)", () => {
    expect(d(true, true, "unloaded")).toBe("wait");
    expect(d(true, true, "error")).toBe("wait");
  });
  test("post-ready mid-session error → wait (U2: latch stays set)", () => {
    // session saw ready → evaluated latched → a later error can't reopen
    expect(d(true, true, "error")).toBe("wait");
  });
});
