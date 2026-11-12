// feature 017 (T040): ext.* bridge — capability gating per method,
// pack-scoped storage, own-pack run visibility, models.generate routing.
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createViewBridge, type BridgeDeps } from "../../src/bun/extensions/bridge";
import type { InstalledPackView } from "../../src/shared/types";
import type { Capability, PackManifest } from "../../src/shared/pack-schema";
import type { ComponentEngine } from "../../src/bun/fabric/components";
import type { RunManager } from "../../src/bun/fabric/runtime";

const manifest = (capabilities: Capability[]): PackManifest => ({
  name: "views-pack",
  version: "1.0.0",
  apiLevel: 1,
  capabilities,
  contributions: {
    commands: [{ id: "digest", title: "Digest", run: { pipeline: "document-summary" } }],
  },
});

const pack = (capabilities: Capability[]): InstalledPackView => ({
  id: "views-pack",
  dir: "/tmp/views-pack",
  state: "enabled",
  source: { kind: "folder", ref: "/tmp/views-pack" },
  manifest: manifest(capabilities),
  installedAt: 0,
});

const engine: ComponentEngine = {
  tokenCount: (t) => t.length,
  generate: async (_p, onToken) => {
    onToken("OUT");
    return { status: "complete", tokens: 3, promptTokens: 5 };
  },
};

const deps = (runs: (() => RunManager | null) = () => null, started: string[] = []): BridgeDeps => ({
  engine: () => engine,
  runs,
  theme: () => ({ mode: "dark", vars: { bg: "#000" } }),
  startRun: (pid, target) => {
    started.push(`${pid}:${target.id}`);
    return "run_x";
  },
});

let data: string;
beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), "extbridge-"));
  process.env.APP_DATA_DIR = data;
});

describe("view bridge", () => {
  test("ext.context needs no capability", () => {
    const b = createViewBridge(pack([]), "explorer", deps());
    const ctx = b["ext.context"]();
    expect(ctx.packId).toBe("views-pack");
    expect(ctx.viewId).toBe("explorer");
    expect(ctx.theme.mode).toBe("dark");
  });

  test("storage gated by capability, then scoped to packDataDir", () => {
    const denied = createViewBridge(pack([]), "v", deps());
    expect(() => denied["ext.storage.set"]({ key: "k", value: 1 })).toThrowError(/CAPABILITY_DENIED|capability/);

    const b = createViewBridge(pack(["storage"]), "v", deps());
    b["ext.storage.set"]({ key: "k", value: 42 });
    expect(b["ext.storage.get"]({ key: "k" })).toEqual({ value: 42 });
    b["ext.storage.remove"]({ key: "k" });
    expect(b["ext.storage.get"]({ key: "k" })).toEqual({ value: null });
    // scoped to this pack's dir — a bridge for another pack sees nothing
    const other = createViewBridge({ ...pack(["storage"]), id: "other-pack" }, "v", deps());
    expect(other["ext.storage.get"]({ key: "k" })).toEqual({ value: null });
  });

  test("runs.list gated; own-pack visibility via manager filter", () => {
    const b = createViewBridge(pack([]), "v", deps());
    expect(() => b["ext.runs.list"]({})).toThrowError(/capability/);
    const runs = { list: (pid?: string) => [{ id: "r1", packId: pid }] };
    const ok = createViewBridge(pack(["runs.read"]), "v", deps(() => runs as never));
    expect((ok["ext.runs.list"]({}) as { runs: { packId: string }[] }).runs[0].packId).toBe("views-pack");
  });

  test("ext.invoke maps command → startRun with declared target", () => {
    const started: string[] = [];
    const b = createViewBridge(pack(["commands.invoke"]), "v", deps(() => null, started));
    const r = b["ext.invoke"]({ commandId: "digest" }) as { runId: string };
    expect(r.runId).toBe("run_x");
    expect(started[0]).toBe("views-pack:document-summary");
    expect(() => b["ext.invoke"]({ commandId: "nope" })).toThrowError(/CONTRIBUTION_NOT_FOUND|no command/);
  });

  test("models.generate routes through engine; empty prompt rejected", async () => {
    const b = createViewBridge(pack(["models.generate"]), "v", deps());
    const res = await b["ext.models.generate"]({ prompt: "hi" });
    expect(res).toEqual({ text: "OUT", usage: { promptTokens: 5, outputTokens: 3 } });
    await expect(b["ext.models.generate"]({ prompt: "" })).rejects.toThrowError(/INVALID_PARAMS|non-empty/);
    const denied = createViewBridge(pack([]), "v", deps());
    await expect(denied["ext.models.generate"]({ prompt: "hi" })).rejects.toThrowError(/capability/);
  });
});
