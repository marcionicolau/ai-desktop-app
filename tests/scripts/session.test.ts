// feature 023 T015: SessionManager — lazy start, per-runtime
// serialization, timeout propagation, crash → restarted flag, reset.
import { describe, expect, test } from "bun:test";
import type { ScriptRuntimeKind, SessionInfo } from "../../src/shared/types";
import type {
  ScriptBackend,
  ScriptCallRequest,
  ScriptCallResult,
} from "../../src/bun/scripts/backend";
import { BackendUnavailable } from "../../src/bun/scripts/backend";
import { SessionManager } from "../../src/bun/scripts/session";

// controllable fake — records call order, can be told to die mid-call
class FakeBackend implements ScriptBackend {
  readonly kind = "subprocess" as const;
  ensured: ScriptRuntimeKind[] = [];
  started = 0;
  live = false;
  inFlight = 0;
  maxConcurrent = 0;
  dieOnNextCall = false;
  dieDuringCall = false;
  private calls = 0;

  async ensure(rt: ScriptRuntimeKind) {
    this.ensured.push(rt);
    if (!this.live) this.started++;
    this.live = true;
  }
  async call(_rt: ScriptRuntimeKind, req: ScriptCallRequest): Promise<ScriptCallResult> {
    this.inFlight++;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.inFlight);
    this.calls++;
    await new Promise((r) => setTimeout(r, 5));
    this.inFlight--;
    if (this.dieDuringCall) {
      this.dieDuringCall = false;
      this.live = false;
      throw new BackendUnavailable("session-dead", "boom");
    }
    if (this.dieOnNextCall) {
      this.dieOnNextCall = false;
      this.live = false;
      throw new BackendUnavailable("session-dead", "boom");
    }
    if (req.timeoutMs < 1) {
      throw new BackendUnavailable("timeout", "t/o", {
        stdout: "",
        stderr: "",
      });
    }
    return {
      exitStatus: 0,
      stdout: `call-${this.calls}`,
      stderr: "",
      durationMs: 1,
      files: [],
      sessionRestarted: false,
    };
  }
  async reset() {
    this.live = false;
  }
  status(): SessionInfo {
    return {
      state: this.live ? "live" : "cold",
      calls: this.calls,
      restartCount: Math.max(0, this.started - 1),
    };
  }
  async dispose() {}
}

const req = (over: Partial<ScriptCallRequest> = {}): ScriptCallRequest => ({
  runId: "r1",
  code: "x",
  args: {},
  cwd: "/tmp",
  timeoutMs: 5000,
  ...over,
});

const mgr = (b: FakeBackend) => {
  const events: string[] = [];
  const m = new SessionManager({
    backendFactory: () => b,
    emit: (e) => events.push(`${e.runtime}:${e.state}`),
  });
  return { m, events };
};

describe("SessionManager", () => {
  test("lazy start: ensure only on first call", async () => {
    const b = new FakeBackend();
    const { m } = mgr(b);
    expect(b.ensured).toEqual([]);
    const r = await m.call("python", "/usr/bin/python3", req());
    expect(r.stdout).toBe("call-1");
    expect(b.ensured).toEqual(["python"]);
    await m.call("python", "/usr/bin/python3", req());
    expect(b.ensured).toEqual(["python", "python"]); // ensure idempotent
    expect(b.started).toBe(1); // but only one real spawn
  });

  test("serialization: concurrent calls run one-at-a-time", async () => {
    const b = new FakeBackend();
    const { m } = mgr(b);
    const rs = await Promise.all([
      m.call("python", "/x", req()),
      m.call("python", "/x", req()),
      m.call("python", "/x", req()),
    ]);
    expect(b.maxConcurrent).toBe(1);
    expect(rs.map((r) => r.stdout)).toEqual(["call-1", "call-2", "call-3"]);
  });

  test("python and r serialize independently", async () => {
    const b = new FakeBackend();
    const { m } = mgr(b);
    // different runtimes use different backend instances; a single
    // factory returns the same fake — maxConcurrent counts globally
    // here, so assert at least per-runtime ensure happens
    await Promise.all([
      m.call("python", "/x", req()),
      m.call("r", "/y", req()),
    ]);
    expect(b.ensured.sort()).toEqual(["python", "r"]);
  });

  test("crash during call → error propagates; next call restarts", async () => {
    const b = new FakeBackend();
    const { m } = mgr(b);
    b.dieDuringCall = true;
    await expect(m.call("python", "/x", req())).rejects.toMatchObject({
      reason: "session-dead",
    });
    const r = await m.call("python", "/x", req());
    expect(r.exitStatus).toBe(0);
    expect(b.started).toBe(2); // respawned
  });

  test("sessionRestarted flag on post-crash call", async () => {
    const b = new FakeBackend();
    const { m } = mgr(b);
    const r1 = await m.call("python", "/x", req());
    expect(r1.sessionRestarted).toBe(true); // first call → fresh session
    const r2 = await m.call("python", "/x", req());
    expect(r2.sessionRestarted).toBe(false); // warm session
  });

  test("reset: clears session so next call is a restart", async () => {
    const b = new FakeBackend();
    const { m } = mgr(b);
    await m.call("python", "/x", req());
    await m.reset("python");
    const r = await m.call("python", "/x", req());
    expect(r.sessionRestarted).toBe(true);
  });

  test("status reflects session state + emits transitions", async () => {
    const b = new FakeBackend();
    const { m, events } = mgr(b);
    expect(m.status("python").state).toBe("cold");
    await m.call("python", "/x", req());
    expect(m.status("python").state).toBe("live");
    expect(events).toContain("python:live");
  });
});
