import { describe, expect, test } from "bun:test";
import { MetricsStore } from "../../src/bun/metrics/store";
import type { MetricEntry } from "../../src/shared/types";

const entry = (n: number): Omit<MetricEntry, "id" | "ts"> => ({
  conversationId: "c1",
  modelFile: "m.gguf",
  roleKey: "main",
  promptTokens: n,
  outputTokens: n,
  elapsedMs: n,
  warm: false,
  status: "complete",
  promptPreview: `preview ${n}`,
});

describe("MetricsStore", () => {
  test("record → list round-trip, ids+ts assigned", () => {
    const s = new MetricsStore();
    const e = s.record(entry(1));
    expect(e.id).toBeTruthy();
    expect(e.ts).toBeTruthy();
    expect(s.list()).toEqual([e]);
  });

  test("ring cap: >500 drops oldest, keeps chronological order", () => {
    const s = new MetricsStore();
    for (let i = 0; i < 510; i++) s.record(entry(i));
    const l = s.list();
    expect(l.length).toBe(500);
    expect(l[0].promptTokens).toBe(10); // oldest 10 dropped
    expect(l[499].promptTokens).toBe(509);
  });

  test("clear empties and is idempotent", () => {
    const s = new MetricsStore();
    s.record(entry(1));
    s.record(entry(2));
    expect(s.clear()).toEqual({ removed: 2 });
    expect(s.list()).toEqual([]);
    expect(s.clear()).toEqual({ removed: 0 });
  });
});
