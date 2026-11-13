// feature 023 T016: ScriptService — policy modes, session grants,
// param validation matrix, initiator + audit plumbing.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScriptRuntimeKind, Settings } from "../../src/shared/types";
import { DEFAULT_GENERATION } from "../../src/shared/types";
import type {
  ScriptBackend,
  ScriptCallRequest,
  ScriptCallResult,
} from "../../src/bun/scripts/backend";
import { SessionManager } from "../../src/bun/scripts/session";
import { ScriptService } from "../../src/bun/scripts/service";

const dir = mkdtempSync(join(tmpdir(), "cz-scripts-svc-"));
process.env.APP_DATA_DIR = dir;

const { ScriptStore } = await import("../../src/bun/scripts/store");
const { auditFile } = await import("../../src/bun/tools/audit");

class FakeBackend implements ScriptBackend {
  readonly kind = "subprocess" as const;
  calls: ScriptCallRequest[] = [];
  async ensure() {}
  async call(_rt: ScriptRuntimeKind, req: ScriptCallRequest): Promise<ScriptCallResult> {
    this.calls.push(req);
    return {
      exitStatus: 0,
      stdout: "out",
      stderr: "",
      durationMs: 2,
      files: [],
      sessionRestarted: false,
    };
  }
  async reset() {}
  status() {
    return { state: "live" as const, calls: this.calls.length, restartCount: 0 };
  }
  async dispose() {}
}

const mkSettings = (scripts?: Settings["scripts"]): Settings => ({
  activeModelPath: null,
  contextLimitWarning: true,
  generation: DEFAULT_GENERATION,
  modelOverrides: {},
  tags: [],
  scripts,
});

// "/usr/bin/env" exists on POSIX — satisfies resolveInterpreter
const mk = (scripts?: Settings["scripts"]) => {
  const backend = new FakeBackend();
  const events: string[] = [];
  const svc = new ScriptService({
    store: new ScriptStore(),
    sessions: new SessionManager({
      backendFactory: () => backend,
      emit: () => {},
    }),
    getSettings: () => mkSettings(scripts),
    emitRun: (e) => events.push(e.phase),
  });
  return { svc, backend, events };
};

const ask = {
  mode: "ask" as const,
  runtimes: { python: { path: "/usr/bin/env" }, r: { path: "/usr/bin/env" } },
};

describe("policy + grants", () => {
  test("unset → deny, inactive", () => {
    const { svc } = mk();
    expect(svc.policy().mode).toBe("deny");
    expect(svc.scriptsActive()).toBe(false);
  });

  test("ask + configured runtimes → active", () => {
    const { svc } = mk(ask);
    expect(svc.scriptsActive()).toBe(true);
    expect(svc.runtimes().map((r) => r.status)).toEqual(["ready", "ready"]);
  });

  test("grants are per-namespace, never persisted", () => {
    const { svc } = mk(ask);
    expect(svc.autoApprove("conv-1")).toBe(false);
    svc.grantSession("conv-1");
    expect(svc.autoApprove("conv-1")).toBe(true);
    expect(svc.autoApprove("conv-2")).toBe(false);
  });

  test("awaitDecision resolves via respond; allowSession grants ns", async () => {
    const { svc } = mk(ask);
    const p = svc.awaitDecision("call-1", "conv-9");
    expect(svc.respond("call-1", "allowSession")).toBe(true);
    await expect(p).resolves.toBe("allowSession");
    expect(svc.autoApprove("conv-9")).toBe(true);
    expect(svc.respond("call-1", "approve")).toBe(false); // gone
  });

  test("discardPending resolves discards for a namespace", async () => {
    const { svc } = mk(ask);
    const p1 = svc.awaitDecision("a", "ns1");
    const p2 = svc.awaitDecision("b", "ns2");
    svc.discardPending("ns1");
    await expect(p1).resolves.toBe("discard");
    expect(svc.respond("b", "deny")).toBe(true);
    await expect(p2).resolves.toBe("deny");
  });
});

describe("upsert validation", () => {
  test("create → slug id; stored source written", () => {
    const { svc } = mk(ask);
    const it = svc.upsert({
      name: "Add One",
      runtime: "python",
      source: { kind: "stored", text: "print(n+1)" },
      params: [{ name: "n", type: "number", required: true }],
    });
    expect(it.id).toBe("add-one");
    expect(it.runtimeStatus).toBe("ready");
  });

  test("duplicate name rejected on create", () => {
    const { svc } = mk(ask);
    svc.upsert({ name: "dup", runtime: "python", source: { kind: "stored", text: "1" } });
    expect(() =>
      svc.upsert({ name: "dup", runtime: "python", source: { kind: "stored", text: "2" } }),
    ).toThrow(/already exists/);
  });

  test("param name/type validation", () => {
    const { svc } = mk(ask);
    const base = { name: "p", runtime: "python" as const, source: { kind: "stored" as const, text: "x" } };
    expect(() => svc.upsert({ ...base, name: "bad1", params: [{ name: "9x", type: "text", required: true }] })).toThrow(/identifier/);
    expect(() => svc.upsert({ ...base, name: "bad2", params: [{ name: "a", type: "text", required: true }, { name: "a", type: "text", required: false }] })).toThrow(/duplicate/);
  });
});

describe("argument validation (FR-006)", () => {
  const entry = (params: import("../../src/shared/types").ScriptParam[]) => ({
    id: "s", runtime: "python" as const, source: { kind: "stored" as const },
    description: "", params, enabled: true,
  });

  test("accept matrix: declared types pass, missing optional ok", () => {
    const { svc } = mk(ask);
    const e = entry([
      { name: "n", type: "number", required: true },
      { name: "label", type: "text", required: false },
      { name: "flag", type: "bool", required: false },
      { name: "data", type: "json", required: false },
    ]);
    const r = svc.validateArgs(e, { n: 2, label: "x", flag: false, data: { k: 1 } });
    expect(r.args.n).toBe(2);
    expect(svc.validateArgs(e, { n: 2 }).args.label).toBeUndefined();
  });

  test("reject matrix: missing required / extra / wrong type", () => {
    const { svc } = mk(ask);
    const e = entry([{ name: "n", type: "number", required: true }]);
    expect(() => svc.validateArgs(e, {})).toThrow(/missing required/);
    expect(() => svc.validateArgs(e, { n: 1, extra: 1 })).toThrow(/undeclared/);
    expect(() => svc.validateArgs(e, { n: "1" })).toThrow(/must be number/);
  });

  test("paramless scripts take raw text input", () => {
    const { svc } = mk(ask);
    const r = svc.validateArgs(entry([]), { input: "hello" });
    expect(r.input).toBe("hello");
    expect(r.args).toEqual({});
  });
});

describe("call: initiator + audit plumbing", () => {
  test("model-initiated call records ScriptRunRecord + audit line", async () => {
    const { svc, backend, events } = mk(ask);
    const it = svc.upsert({
      name: "audit-me",
      runtime: "python",
      source: { kind: "stored", text: "print(1)" },
    });
    const rec = await svc.call({
      entry: svc.get(it.id)!,
      args: {},
      initiator: "model",
      ns: "conv-42",
      conversationId: "conv-42",
      messageId: "m1",
      callId: "tc-1",
      emitRun: true,
    });
    expect(rec.verdict).toBe("executed");
    expect(rec.initiator).toBe("model");
    expect(backend.calls).toHaveLength(1);
    expect(events).toEqual(["queued", "running", "done"]);
    // audit line written with script fields
    const lines = readFileSync(auditFile(), "utf8").trim().split("\n");
    const last = JSON.parse(lines.at(-1)!);
    expect(last.tool).toBe("run_script");
    expect(last.script).toBe("audit-me");
    expect(last.initiator).toBe("model");
    expect(last.verdict).toBe("executed");
  });

  test("manual call → audit line without conv ids (FR-013)", async () => {
    const { svc } = mk(ask);
    const it = svc.upsert({
      name: "manual-run",
      runtime: "python",
      source: { kind: "stored", text: "1" },
    });
    const before = existsSync(auditFile())
      ? readFileSync(auditFile(), "utf8").trim().split("\n").length
      : 0;
    const rec = await svc.call({
      entry: svc.get(it.id)!,
      initiator: "user",
      ns: "manual",
    });
    expect(rec.verdict).toBe("executed");
    const after = readFileSync(auditFile(), "utf8").trim().split("\n");
    expect(after.length).toBe(before + 1); // FR-013: user-initiated runs audit too
    const line = JSON.parse(after[after.length - 1] as string);
    expect(line.initiator).toBe("user");
    expect(line.conversationId).toBeUndefined();
  });

  test("missing script source → SCRIPT_NOT_FOUND", async () => {
    const { svc } = mk(ask);
    const it = svc.upsert({
      name: "gone",
      runtime: "python",
      source: { kind: "external", path: "/nonexistent/x.py" },
    });
    await expect(
      svc.call({ entry: svc.get(it.id)!, initiator: "user", ns: "manual" }),
    ).rejects.toMatchObject({ code: "SCRIPT_NOT_FOUND" });
  });
});
