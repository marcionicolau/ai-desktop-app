// feature 023 T032: script.*/runtime.* RPC handlers — CRUD validation,
// slug collision, delete cascade, manual-run record shape, external
// source degradation.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequestHandlers, type HandlerDeps, type StoreLike } from "../../src/bun/rpc/handlers";
import { ScriptService } from "../../src/bun/scripts/service";
import { SessionManager } from "../../src/bun/scripts/session";
import type { ScriptBackend, ScriptCallRequest, ScriptCallResult } from "../../src/bun/scripts/backend";
import type { ScriptRuntimeKind, Settings } from "../../src/shared/types";
import { DEFAULT_GENERATION } from "../../src/shared/types";

const dir = mkdtempSync(join(tmpdir(), "cz-scripts-rpc-"));
process.env.APP_DATA_DIR = dir;
const { ScriptStore } = await import("../../src/bun/scripts/store");

class FakeBackend implements ScriptBackend {
  readonly kind = "subprocess" as const;
  calls: ScriptCallRequest[] = [];
  async ensure() {}
  async call(_rt: ScriptRuntimeKind, req: ScriptCallRequest): Promise<ScriptCallResult> {
    this.calls.push(req);
    return {
      exitStatus: 0, stdout: '{"ok":true}', stderr: "",
      durationMs: 3, files: [], sessionRestarted: false,
    };
  }
  async reset() {}
  status() { return { state: "live" as const, calls: this.calls.length, restartCount: 0 }; }
  async dispose() {}
}

const mk = () => {
  const settings: Settings = {
    activeModelPath: null,
    contextLimitWarning: false,
    generation: DEFAULT_GENERATION,
    modelOverrides: {},
    tags: [],
    scripts: { mode: "ask", backend: "auto" },
  } as Settings;
  const backend = new FakeBackend();
  const emitted: { method: string; payload: unknown }[] = [];
  const svc = new ScriptService({
    store: new ScriptStore(),
    sessions: new SessionManager({ backendFactory: () => backend, emit: () => {} }),
    getSettings: () => settings,
    emitRun: (e) => emitted.push({ method: "script.run", payload: e }),
  });
  const deps: HandlerDeps = {
    engine: {
      status: () => ({ status: "ready", name: "fake.gguf" }),
      loadModel: async () => ({ status: "ready" as const, name: "fake.gguf" }),
      unloadModel: () => {},
      isGenerating: () => false,
      contextSize: () => 4096,
      chatTemplate: () => null,
      tokenCount: (t: string) => Math.ceil(t.length / 4),
      stop: () => {},
      generate: async () => ({ status: "complete" as const, tokens: 1, elapsedMs: 1, warm: false }),
    },
    store: {
      getConversation: () => null,
      saveConversation: () => {},
      listConversations: () => [],
      deleteConversation: () => {},
      getSettings: () => settings,
      saveSettings: (s) => Object.assign(settings, s),
    } as StoreLike,
    emit: (m, p) => emitted.push({ method: m, payload: p }),
    scripts: svc,
  };
  return { h: createRequestHandlers(deps), backend, emitted, settings };
};

const STORED = { kind: "stored" as const, text: "print(1)" };

describe("script.* RPC", () => {
  test("upsert → list round-trips entry with slug id", () => {
    const { h } = mk();
    const { entry } = h["script.upsert"]({
      name: "Add One", runtime: "python", source: STORED,
      params: [{ name: "n", type: "number", required: true, description: "" }],
    });
    expect(entry.id).toBe("add-one");
    expect(h["script.list"]().scripts.some((s) => s.id === "add-one")).toBe(true);
  });

  test("duplicate name → INVALID_PARAMS", () => {
    const { h } = mk();
    h["script.upsert"]({ name: "dup", runtime: "python", source: STORED });
    expect(() =>
      h["script.upsert"]({ name: "dup", runtime: "python", source: STORED }),
    ).toThrowError(/already exists/);
  });

  test("non-slug name → INVALID_PARAMS", () => {
    const { h } = mk();
    expect(() =>
      h["script.upsert"]({ name: "!!!", runtime: "python", source: STORED }),
    ).toThrowError(/slug-safe/);
  });

  test("bad param name / type → INVALID_PARAMS", () => {
    const { h } = mk();
    expect(() =>
      h["script.upsert"]({
        name: "p1", runtime: "python", source: STORED,
        params: [{ name: "1bad", type: "number", required: true, description: "" }],
      }),
    ).toThrowError(/identifier/);
    expect(() =>
      h["script.upsert"]({
        name: "p2", runtime: "python", source: STORED,
        params: [{ name: "ok", type: "weird", required: true, description: "" }],
      }),
    ).toThrowError(/unknown param type/);
  });

  test("delete removes entry + stored source", () => {
    const { h } = mk();
    const { entry } = h["script.upsert"]({ name: "gone", runtime: "python", source: STORED });
    h["script.delete"]({ id: entry.id });
    expect(h["script.list"]().scripts.some((s) => s.id === "gone")).toBe(false);
    expect(existsSync(join(dir, "scripts", "gone.py"))).toBe(false);
  });

  test("script.enable toggles + gates script.run", async () => {
    const { h } = mk();
    const { entry } = h["script.upsert"]({ name: "toggle", runtime: "python", source: STORED });
    h["script.enable"]({ id: entry.id, enabled: false });
    await expect(h["script.run"]({ id: entry.id })).rejects.toThrowError(/disabled/);
    h["script.enable"]({ id: entry.id, enabled: true });
    const rec = await h["script.run"]({ id: entry.id });
    expect(rec.verdict).toBe("executed");
    expect(rec.stdout).toBe('{"ok":true}');
    expect(rec.initiator).toBe("user");
  });

  test("script.run emits queued→running→done phases", async () => {
    const { h, emitted } = mk();
    const { entry } = h["script.upsert"]({ name: "phases", runtime: "python", source: STORED });
    await h["script.run"]({ id: entry.id });
    const phases = emitted
      .filter((e) => e.method === "script.run")
      .map((e) => (e.payload as { phase: string }).phase);
    expect(phases).toEqual(["queued", "running", "done"]);
  });

  test("missing external source → SCRIPT_NOT_FOUND on run", async () => {
    const { h } = mk();
    const { entry } = h["script.upsert"]({
      name: "ext", runtime: "python",
      source: { kind: "external", path: join(dir, "absent.py") },
    });
    await expect(h["script.run"]({ id: entry.id })).rejects.toThrowError(/unavailable|SCRIPT_NOT_FOUND/);
  });
});

describe("runtime.* RPC", () => {
  test("runtime.list reports both kinds with configured paths", () => {
    const { h, settings } = mk();
    settings.scripts = {
      mode: "ask", backend: "auto",
      runtimes: { python: { path: "/usr/bin/env" }, r: { path: "/usr/bin/env" } },
    };
    const { runtimes } = h["runtime.list"]();
    expect(runtimes.map((r: { kind: string }) => r.kind)).toEqual(["python", "r"]);
    expect(runtimes[0].status).toBe("ready");
    expect(runtimes[0].session).toBeTruthy();
  });

  test("runtime.detect returns a path or RUNTIME_NOT_FOUND", () => {
    const { h } = mk();
    const { path } = h["runtime.detect"]({ kind: "python" });
    expect(path).toBeTruthy();
  });

  test("runtime.reset returns without error", async () => {
    const { h } = mk();
    await h["runtime.reset"]({ kind: "python" });
  });
});
