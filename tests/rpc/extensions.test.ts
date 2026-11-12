// feature 017 (T016 + T023): extension.* + pack.* over the RPC boundary —
// full lifecycle, consent gate, preview-only, contributions/readSpec.
// Runs against the real default ExtensionsStore (APP_DATA_DIR sandboxed).
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RolesService } from "../../src/bun/models/roles";
import {
  createRequestHandlers,
  type EngineLike,
  type StoreLike,
} from "../../src/bun/rpc/handlers";
import type { Conversation, Settings } from "../../src/shared/types";
import { DEFAULT_GENERATION } from "../../src/shared/types";

const FX = join(import.meta.dir, "../extensions/fixtures");
let data: string;

const store: StoreLike = (() => {
  const convs = new Map<string, Conversation>();
  const settings: Settings = {
    activeModelPath: null,
    contextLimitWarning: false,
    generation: DEFAULT_GENERATION,
    modelOverrides: {},
  };
  return {
    getConversation: (id) => convs.get(id) ?? null,
    saveConversation: (c) => void convs.set(c.id, c),
    listConversations: () => [...convs.values()].map((c) => ({
      id: c.id, title: c.title, updatedAt: c.updatedAt,
    })),
    deleteConversation: (id) => convs.delete(id),
    getSettings: () => settings,
    saveSettings: (n) => Object.assign(settings, n),
  };
})();

const engine: EngineLike = {
  status: () => ({ status: "ready", name: "e.gguf" }),
  loadModel: async (p: string) => ({ status: "ready", name: p }),
  unloadModel: () => {},
  isGenerating: () => false,
  contextSize: () => 4096,
  chatTemplate: () => null,
  tokenCount: (t: string) => t.length,
  generate: async (_p, onToken) => {
    onToken?.('{"summary":"s","actions":"a"}');
    return { status: "complete" as const, tokens: 3, elapsedMs: 1, warm: true, promptTokens: 5 };
  },
  stop: () => {},
};

const make = () => {
  const emitted: { method: string; payload: unknown }[] = [];
  const deps = {
    engine,
    store,
    roles: new RolesService({ store, scan: () => [] }),
    emit: (m: string, p: unknown) => emitted.push({ method: m, payload: p }),
    dialogs: { pickFolder: async () => null, pickFile: async () => null },
  } as never;
  const handlers = createRequestHandlers(deps) as never;
  const call = async (method: string, params: Record<string, unknown> = {}) =>
    handlers[method](params);
  return { call, emitted };
};

const notesSource = { kind: "folder", path: join(FX, "notes-pack") };

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), "rpc-ext-"));
  process.env.APP_DATA_DIR = data;
  process.env.MODELS_DIR = data;
  writeFileSync(join(data, "e.gguf"), "x");
});

describe("extension.* rpc", () => {
  test("lifecycle: install → consent → enable → disable → remove", async () => {
    const { call, emitted } = make();
    const { pack } = await call("extension.install", { source: notesSource });
    expect(pack.id).toBe("notes-pack");
    expect(pack.state).toBe("installed");
    // capabilities non-empty → consent required
    await expect(call("extension.enable", { packId: pack.id })).rejects.toThrowError(/consent/);
    const enabled = await call("extension.enable", { packId: pack.id, consent: true });
    expect(enabled.pack.state).toBe("enabled");
    expect(emitted.filter((e) => e.method === "extension.changed").length).toBeGreaterThan(0);
    const disabled = await call("extension.disable", { packId: pack.id });
    expect(disabled.pack.state).toBe("disabled");
    await call("extension.remove", { packId: pack.id, purgeData: true });
    const { packs } = await call("extension.scan", {});
    expect(packs.find((p: { id: string }) => p.id === "notes-pack")).toBeUndefined();
  });

  test("preview validates without installing", async () => {
    const { call } = make();
    const prev = await call("extension.preview", { source: notesSource });
    expect(prev.manifest.name).toBe("notes-pack");
    const { packs } = await call("extension.scan", {});
    expect(packs).toHaveLength(0);
  });

  test("malformed pack installs (valid manifest) but fails at enable", async () => {
    const { call } = make();
    const { pack } = await call("extension.install", {
      source: { kind: "folder", path: join(FX, "broken-pack") },
    });
    expect(pack.state).toBe("installed");
    await expect(
      call("extension.enable", { packId: pack.id, consent: true }),
    ).rejects.toThrowError();
  });
});

describe("pack.* rpc", () => {
  const enableNotes = async (call: (m: string, p?: Record<string, unknown>) => Promise<never>) => {
    const { pack } = await call("extension.install", { source: notesSource });
    await call("extension.enable", { packId: pack.id, consent: true });
    return pack.id as string;
  };

  test("contributions returns namespaced descriptors incl. commands", async () => {
    const { call } = make();
    const packId = await enableNotes(call);
    const c = await call("pack.contributions", { packId });
    expect(c.skills.map((s: { id: string }) => s.id)).toContain("notes-pack:summarize_notes");
    expect(c.pipelines.map((p: { id: string }) => p.id)).toContain("notes-pack:document_summary");
    expect(c.agents.map((a: { id: string }) => a.id)).toContain("notes-pack:note_taker");
    expect(c.commands[0].id).toBe("digest");
  });

  test("readSpec returns frontmatter + body; missing → CONTRIBUTION_NOT_FOUND", async () => {
    const { call } = make();
    await enableNotes(call);
    const spec = await call("pack.readSpec", { contributionId: "notes-pack:summarize_notes" });
    expect(spec.frontmatter.name).toBe("summarize_notes");
    expect(spec.body).toContain("Summarize notes");
    await expect(
      call("pack.readSpec", { contributionId: "notes-pack:ghost" }),
    ).rejects.toThrowError(/CONTRIBUTION_NOT_FOUND|no contribution/);
  });

  test("contributions for unknown pack → PACK_NOT_FOUND", async () => {
    const { call } = make();
    await expect(call("pack.contributions", { packId: "nope" })).rejects.toThrowError(/no pack/);
  });
});
