// feature 010 (T013/T015): snapshot.stats / snapshot.clear contract via
// an injected SnapshotStore; absent dep → disabled surface.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRequestHandlers,
  type EngineLike,
  type StoreLike,
} from "../../src/bun/rpc/handlers";
import { SnapshotStore, entryKey } from "../../src/bun/kv/store";
import type { Settings } from "../../src/shared/types";
import { DEFAULT_GENERATION } from "../../src/shared/types";

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function baseDeps(settings: Settings) {
  const engine: EngineLike = {
    status: () => ({ status: "ready" as const, name: "m.gguf" }),
    loadModel: async () => ({ status: "ready" as const, name: "m.gguf" }),
    unloadModel: () => {},
    isGenerating: () => false,
    contextSize: () => 4096,
    chatTemplate: () => null,
    tokenCount: (t) => Math.ceil(t.length / 4),
    generate: async (_p, onToken) => {
      onToken("x");
      return { status: "complete" as const, tokens: 1, elapsedMs: 1, warm: false };
    },
    stop: () => {},
  };
  const store: StoreLike = {
    getConversation: () => null,
    saveConversation: () => {},
    listConversations: () => [],
    deleteConversation: () => {},
    getSettings: () => settings,
    saveSettings: () => {},
  };
  return { engine, store, emit: () => {} };
}

const settings = (snapshot?: Settings["snapshot"]): Settings =>
  ({
    activeModelPath: "m.gguf",
    contextLimitWarning: false,
    generation: DEFAULT_GENERATION,
    modelOverrides: {},
    tags: [],
    snapshot,
  }) as Settings;

describe("snapshot.* rpc", () => {
  test("stats + clear round-trip through injected store", () => {
    const d = mkdtempSync(join(tmpdir(), "snap-"));
    dirs.push(d);
    const snap = new SnapshotStore(d, { enabled: true, maxBytes: 1e9 });
    // seed one snapshot via the store API (blob then manifest)
    const key = entryKey("c1", "main");
    writeFileSync(snap.blobPath(key), Buffer.alloc(1234));
    snap.save({
      key,
      convId: "c1",
      roleKey: "main",
      modelPath: "/m.gguf",
      fingerprint: "fp",
      ctxSize: 4096,
    });
    const h = createRequestHandlers({
      ...baseDeps(settings({ enabled: true, maxBytes: 500_000_000 })),
      snapshots: snap,
    });
    // settings.snapshot overrides the injected policy per call
    expect(h["snapshot.stats"]()).toEqual({
      count: 1,
      usedBytes: 1234,
      maxBytes: 500_000_000,
    });
    expect(h["snapshot.clear"]()).toEqual({ removed: 1, freedBytes: 1234 });
    expect(h["snapshot.stats"]().count).toBe(0);
  });

  test("settings.policy syncs per call — disable zeroes stats surface", () => {
    const d = mkdtempSync(join(tmpdir(), "snap-"));
    dirs.push(d);
    const snap = new SnapshotStore(d, { enabled: true, maxBytes: 1e9 });
    const h = createRequestHandlers({
      ...baseDeps(settings({ enabled: false, maxBytes: 0 })),
      snapshots: snap,
    });
    expect(h["snapshot.stats"]().maxBytes).toBe(0);
  });

  test("absent snapshots dep → disabled surface, no crash", () => {
    const h = createRequestHandlers(baseDeps(settings()));
    expect(h["snapshot.stats"]()).toEqual({
      count: 0,
      usedBytes: 0,
      maxBytes: 0,
    });
    expect(h["snapshot.clear"]()).toEqual({ removed: 0, freedBytes: 0 });
  });
});
