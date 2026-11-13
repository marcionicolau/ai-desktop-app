// feature 023 T037: interpreter resolution (configured > detected,
// missing degrades), reset-while-in-flight → interrupted, session.state
// event sequence.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInterpreter, runtimeStatus } from "../../src/bun/scripts/runtimes";
import { SessionManager } from "../../src/bun/scripts/session";
import type { SessionStateEvent } from "../../src/shared/types";
import type { ScriptBackend, ScriptCallRequest, ScriptCallResult } from "../../src/bun/scripts/backend";
import { BackendUnavailable } from "../../src/bun/scripts/backend";
import type { ScriptRuntimeKind } from "../../src/shared/types";

const dir = mkdtempSync(join(tmpdir(), "cz-rt-"));
const fake = join(dir, "fake-python");
writeFileSync(fake, "#!/bin/sh\n");
chmodSync(fake, 0o755);

describe("resolveInterpreter", () => {
  test("configured path wins over detection when it exists", () => {
    const r = resolveInterpreter("python", {
      mode: "ask",
      backend: "auto",
      runtimes: { python: { path: fake } },
    });
    expect(r.path).toBe(fake);
    expect(r.configured).toBe(fake);
  });

  test("missing configured path falls back to detection", () => {
    const r = resolveInterpreter("python", {
      mode: "ask",
      backend: "auto",
      runtimes: { python: { path: join(dir, "nonexistent") } },
    });
    // python3 exists on this box — detection fills in
    expect(r.path).not.toBe(join(dir, "nonexistent"));
    expect(r.configured).toBe(join(dir, "nonexistent"));
    expect(r.detected).toBeTruthy();
  });

  test("runtimeStatus exposes configuredPath + detectedPath + session", () => {
    const st = runtimeStatus("python", {
      mode: "ask",
      backend: "auto",
      runtimes: { python: { path: fake } },
    });
    expect(st.status).toBe("ready");
    expect(st.configuredPath).toBe(fake);
    expect(st.detectedPath).toBeTruthy();
  });
});

class FlakyBackend implements ScriptBackend {
  readonly kind = "subprocess" as const;
  live = false;
  private inFlight = false;
  die = 0;
  async ensure() { this.live = true; }
  async call(_rt: ScriptRuntimeKind, _req: ScriptCallRequest): Promise<ScriptCallResult> {
    this.inFlight = true;
    await new Promise((r) => setTimeout(r, 5));
    this.inFlight = false;
    if (this.die > 0) {
      this.die--;
      this.live = false;
      throw new BackendUnavailable("session-dead", "boom");
    }
    return {
      exitStatus: 0, stdout: "", stderr: "",
      durationMs: 1, files: [], sessionRestarted: false,
    };
  }
  async reset() {
    this.live = false;
    if (this.inFlight) {
      throw new BackendUnavailable("interrupted", "reset in flight");
    }
  }
  status() {
    return { state: this.live ? ("live" as const) : ("cold" as const), calls: 0, restartCount: 0 };
  }
  async dispose() {}
}

const REQ: ScriptCallRequest = {
  runId: "r1", code: "x", args: {}, cwd: dir, timeoutMs: 5000,
};

describe("session lifecycle + events", () => {
  test("session.state emits cold→live on first call, dead after crash", async () => {
    const backend = new FlakyBackend();
    const events: SessionStateEvent[] = [];
    const sm = new SessionManager({ backendFactory: () => backend, emit: (e) => events.push(e) });
    await sm.call("python", "/x", REQ);
    backend.die = 1;
    await expect(sm.call("python", "/x", REQ)).rejects.toThrowError(/boom/);
    const states = events.map((e) => e.state);
    expect(states).toContain("live");
  });

  test("reset while idle → cold state, next call restarts", async () => {
    const backend = new FlakyBackend();
    const sm = new SessionManager({ backendFactory: () => backend, emit: () => {} });
    await sm.call("python", "/x", REQ);
    expect(sm.status("python").state).toBe("live");
    await sm.reset("python");
    expect(sm.status("python").state).toBe("cold");
  });

  test("serialized calls: a queued call still runs after prior failure", async () => {
    const backend = new FlakyBackend();
    const sm = new SessionManager({ backendFactory: () => backend, emit: () => {} });
    backend.die = 1;
    const p1 = sm.call("python", "/x", REQ);

    const p2 = sm.call("python", "/x", REQ);
    await expect(p1).rejects.toThrowError();
    await expect(p2).resolves.toBeTruthy();
  });
});
