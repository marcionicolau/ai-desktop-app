// feature 026 (FR-027): coalesce bursts (a panel being dragged) into at most
// one call per `ms`, always delivering the LAST request so the final state is
// never dropped. Timers are injectable for tests.
export interface Timers {
  now(): number;
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  now: () => performance.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function throttleTrailing(fn: () => void, ms: number, t: Timers = realTimers) {
  let handle: unknown = null;
  let last = -Infinity;
  const run = () => {
    handle = null;
    last = t.now();
    fn();
  };
  return {
    schedule() {
      if (handle !== null) return; // a call is already queued; it will see the latest state
      handle = t.set(run, Math.max(0, ms - (t.now() - last)));
    },
    cancel() {
      if (handle !== null) t.clear(handle);
      handle = null;
    },
  };
}
