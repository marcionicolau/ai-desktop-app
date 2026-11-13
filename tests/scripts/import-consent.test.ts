// feature 027 (T011/T012/T017/T018): import validation + batch semantics,
// consentState changed-content re-consent, changedGrants, fingerprint
// baseline, audit origin, sourceState — all at service level (the two
// call sites consume consentState identically).
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

const dir = mkdtempSync(join(tmpdir(), "cz-scripts-027-"));
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
      exitStatus: 0, stdout: "ok", stderr: "",
      durationMs: 1, files: [], sessionRestarted: false,
    };
  }
  async reset() {}
  status() { return { state: "live" as const, calls: this.calls.length, restartCount: 0 }; }
  async dispose() {}
}

const ask = {
  mode: "ask" as const,
  runtimes: { python: { path: "/usr/bin/env" }, r: { path: "/usr/bin/env" } },
};
const allowAll = { ...ask, mode: "allow-session" as const };

const mk = (scripts?: Settings["scripts"]) => {
  const backend = new FakeBackend();
  const svc = new ScriptService({
    store: new ScriptStore(),
    sessions: new SessionManager({ backendFactory: () => backend, emit: () => {} }),
    getSettings: () => ({
      activeModelPath: null,
      contextLimitWarning: false,
      generation: DEFAULT_GENERATION,
      modelOverrides: {},
      tags: [],
      scripts,
    }) as Settings,
    emitRun: () => {},
  });
  return { svc, backend };
};

const write = (name: string, text: string) => {
  const p = join(dir, name);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, text);
  return p;
};

describe("import validation (T012)", () => {
  test("runtime from extension, case-insensitive; bad ext → unsupported-ext", () => {
    const { svc } = mk(ask);
    const py = write("a.py", "print(1)");
    const r = write("b.R", "cat(1)");
    const bad = write("c.js", "1");
    const [c1, c2, c3] = svc.importCandidates([py, r, bad]);
    expect(c1.runtime).toBe("python");
    expect(c2.runtime).toBe("r");
    expect(c3.error?.code).toBe("unsupported-ext");
  });

  test("missing file → unreadable; binary → invalid-encoding", () => {
    const { svc } = mk(ask);
    const bin = write("bin.py", "a");
    writeFileSync(bin, Buffer.from([0x00, 0x01, 0x02]));
    const [c1, c2] = svc.importCandidates(["/nonexistent/x.py", bin]);
    expect(c1.error?.code).toBe("unreadable");
    expect(c2.error?.code).toBe("invalid-encoding");
  });

  test("suggestedId slug + dedup vs registry and within batch", () => {
    const { svc } = mk(ask);
    svc.upsert({ name: "my-tool", runtime: "python", source: { kind: "stored", text: "1" } });
    const p1 = write(join("one", "My Tool.py"), "1");
    const p2 = write(join("two", "My Tool.py"), "2");
    const [c1, c2] = svc.importCandidates([p1, p2]);
    expect(c1.suggestedId).toBe("my-tool-2");
    expect(c2.suggestedId).toBe("my-tool-3");
  });
});

describe("importFiles (T011)", () => {
  test("link creates external entry + fingerprint; copy stores bytes", () => {
    const { svc } = mk(ask);
    const p = write("tool.py", "print(1)");
    const [r1] = svc.importFiles({ mode: "link", files: [{ path: p, id: "tool" }] });
    expect(r1.status).toBe("imported");
    const e = svc.get("tool")!;
    expect(e.source).toEqual({ kind: "external", path: p });
    expect(e.approvedFingerprint).toBeTruthy();

    const p2 = write("tool2.py", "print(2)");
    svc.importFiles({ mode: "copy", files: [{ path: p2, id: "tool2" }] });
    const e2 = svc.get("tool2")!;
    expect(e2.source).toEqual({ kind: "stored" });
    expect(e2.approvedFingerprint).toBeUndefined();
  });

  test("already-linked path → duplicate with existing id (both modes)", () => {
    const { svc } = mk(ask);
    const p = write("dup.py", "1");
    svc.importFiles({ mode: "link", files: [{ path: p, id: "first" }] });
    const [r] = svc.importFiles({ mode: "copy", files: [{ path: p, id: "second" }] });
    expect(r.status).toBe("duplicate");
    expect(r.id).toBe("first");
  });

  test("per-file failure does not abort the batch; >10 rejected", () => {
    const { svc } = mk(ask);
    const good = write("good.py", "1");
    const r = svc.importFiles({
      mode: "link",
      files: [
        { path: good, id: "good" },
        { path: "/nope.py", id: "bad" },
        { path: good + "2", id: "Bad ID!" },
      ],
    });
    expect(r.map((x) => x.status)).toEqual(["imported", "failed", "failed"]);
    expect(() =>
      svc.importFiles({
        mode: "link",
        files: Array.from({ length: 11 }, (_, i) => ({ path: `/${i}.py`, id: `s${i}` })),
      }),
    ).toThrowError(/1–10/);
  });
});

describe("migration (T027/FR-021)", () => {
  test("pre-027 registry entries list + run unchanged", async () => {
    const { svc } = mk(allowAll);
    // simulate a registry written before this feature: no
    // approvedFingerprint, no linked/sourceState fields
    const store = (svc as unknown as { deps: { store: InstanceType<typeof ScriptStore> } })
      .deps.store;
    const ext = write("legacy.py", "print(1)");
    store.upsert({
      id: "legacy-ext",
      runtime: "python",
      source: { kind: "external", path: ext },
      description: "",
      params: [],
      enabled: true,
    });
    store.upsert({
      id: "legacy-stored",
      runtime: "r",
      source: { kind: "stored" },
      description: "",
      params: [],
      enabled: false,
    });
    const items = svc.list();
    const le = items.find((s) => s.id === "legacy-ext")!;
    expect(le.linked).toBe(true);
    expect(le.sourceState).toBe("ok");
    expect(items.find((s) => s.id === "legacy-stored")!.linked).toBe(false);
    // absent fingerprint ⇒ first model/pipeline run re-prompts once (safe)
    expect(svc.consentState(le, "ns")).toBe("ask-changed");
  });
});

describe("consentState + changed content (T017/T018)", () => {
  test("linked + missing source → source-missing", () => {
    const { svc } = mk(allowAll);
    svc.upsert({ name: "gone", runtime: "python", source: { kind: "external", path: "/nonexistent/x.py" } });
    expect(svc.consentState(svc.get("gone")!, "ns")).toBe("source-missing");
  });

  test("linked file unchanged → auto under session allow", () => {
    const { svc } = mk(allowAll);
    const p = write("stable.py", "print(1)");
    svc.importFiles({ mode: "link", files: [{ path: p, id: "stable" }] });
    expect(svc.consentState(svc.get("stable")!, "ns")).toBe("auto");
  });

  test("content changed → ask-changed even under allow-session", () => {
    const { svc } = mk(allowAll);
    const p = write("mut.py", "print(1)");
    svc.importFiles({ mode: "link", files: [{ path: p, id: "mut" }] });
    writeFileSync(p, "print(999)");
    expect(svc.consentState(svc.get("mut")!, "ns")).toBe("ask-changed");
  });

  test("approveChangedSession grants only that script for the ns", () => {
    const { svc } = mk(allowAll);
    const p1 = write("m1.py", "1");
    const p2 = write("m2.py", "2");
    svc.importFiles({ mode: "link", files: [
      { path: p1, id: "m1" }, { path: p2, id: "m2" },
    ] });
    writeFileSync(p1, "changed1");
    writeFileSync(p2, "changed2");
    const pending = svc.awaitDecision("call-1", "ns", "m1");
    svc.respond("call-1", "approveChangedSession");
    void pending;
    expect(svc.consentState(svc.get("m1")!, "ns")).toBe("auto");
    expect(svc.consentState(svc.get("m2")!, "ns")).toBe("ask-changed");
  });

  test("successful manual run refreshes the fingerprint baseline", async () => {
    const { svc } = mk(allowAll);
    const p = write("base.py", "v1");
    svc.importFiles({ mode: "link", files: [{ path: p, id: "base" }] });
    writeFileSync(p, "v2");
    await svc.call({ entry: svc.get("base")!, initiator: "user", ns: "manual" });
    expect(svc.consentState(svc.get("base")!, "ns")).toBe("auto");
  });

  test("stored scripts unaffected by the changed-content check", () => {
    const { svc } = mk(allowAll);
    svc.upsert({ name: "s", runtime: "python", source: { kind: "stored", text: "1" } });
    expect(svc.consentState(svc.get("s")!, "ns")).toBe("auto");
  });

  test("audit record carries linked origin + path", async () => {
    const { svc } = mk(allowAll);
    const p = write("aud.py", "1");
    svc.importFiles({ mode: "link", files: [{ path: p, id: "aud" }] });
    await svc.call({ entry: svc.get("aud")!, initiator: "user", ns: "manual" });
    const lines = readFileSync(auditFile(), "utf8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.origin).toBe("linked");
    expect(last.sourcePath).toBe(p);
  });

  test("sourceState reported on list(); relink restores ok + new baseline", () => {
    const { svc } = mk(ask);
    const p = write("rl.py", "v1");
    svc.importFiles({ mode: "link", files: [{ path: p, id: "rl" }] });
    const gone = write("gone.py", "x");
    svc.importFiles({ mode: "link", files: [{ path: gone, id: "gl" }] });
    // simulate a move: point the entry at a now-missing path via upsert
    svc.upsert({
      id: "gl", name: "gl", runtime: "python",
      source: { kind: "external", path: "/nonexistent/gone.py" },
    });
    expect(svc.list().find((s) => s.id === "gl")!.sourceState).toBe("missing");
    const np = write("rl2.py", "v2");
    const back = svc.relink("gl", np);
    expect(back.sourceState).toBe("ok");
    expect(svc.get("gl")!.source).toEqual({ kind: "external", path: np });
    expect(svc.get("gl")!.approvedFingerprint).toBeTruthy();
  });
});
