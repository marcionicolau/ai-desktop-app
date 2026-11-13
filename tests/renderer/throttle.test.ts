import { describe, expect, test } from "bun:test";
import { throttleTrailing, type Timers } from "../../src/renderer/src/lib/throttle";

function fakeTimers() {
  let t = 0;
  const q: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  const timers: Timers = {
    now: () => t,
    set: (fn, ms) => {
      const id = next++;
      q.push({ at: t + ms, fn, id });
      return id;
    },
    clear: (h) => {
      const i = q.findIndex((x) => x.id === h);
      if (i >= 0) q.splice(i, 1);
    },
  };
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      q.sort((a, b) => a.at - b.at);
      const due = q[0];
      if (!due || due.at > end) break;
      q.shift();
      t = due.at;
      due.fn();
    }
    t = end;
  };
  return { timers, advance };
}

describe("throttleTrailing", () => {
  test("a burst becomes one call per interval, and the last one always lands", () => {
    const { timers, advance } = fakeTimers();
    let calls = 0;
    const th = throttleTrailing(() => calls++, 50, timers);
    // 20 changes within 40 ms
    for (let i = 0; i < 20; i++) {
      th.schedule();
      advance(2);
    }
    advance(100);
    expect(calls).toBeLessThanOrEqual(2);
    expect(calls).toBeGreaterThanOrEqual(1);
    const before = calls;
    // a later change is delivered, not dropped
    th.schedule();
    advance(100);
    expect(calls).toBe(before + 1);
  });

  test("a single change fires once, immediately when idle", () => {
    const { timers, advance } = fakeTimers();
    let calls = 0;
    const th = throttleTrailing(() => calls++, 50, timers);
    th.schedule();
    advance(0);
    expect(calls).toBe(1);
  });

  test("cancel drops a queued call", () => {
    const { timers, advance } = fakeTimers();
    let calls = 0;
    const th = throttleTrailing(() => calls++, 50, timers);
    th.schedule();
    th.cancel();
    advance(200);
    expect(calls).toBe(0);
  });
});
