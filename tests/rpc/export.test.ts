// RPC contract tests for feature 008 export/import + backup/restore.
// Uses the injectable dialogs dep so pickers resolve to a temp dir/file.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EngineError } from "../../src/bun/llama/engine";
import {
  createRequestHandlers,
  type EngineLike,
  type HandlerDeps,
  type StoreLike,
} from "../../src/bun/rpc/handlers";
import { parseEnvelope } from "../../src/bun/export/importer";
import { EXPORT_FORMAT_VERSION } from "../../src/shared/export";
import type {
  Conversation,
  Message,
  Settings,
} from "../../src/shared/types";
import { DEFAULT_GENERATION } from "../../src/shared/types";

function msg(id: string, parentId: string | null): Message {
  return {
    id,
    conversationId: "c1",
    role: id.startsWith("u") ? "user" : "assistant",
    content: `content-${id}`,
    status: "complete",
    createdAt: "2025-01-01T00:00:00.000Z",
    completedAt: "2025-01-01T00:00:01.000Z",
    parentId,
  };
}

const makeConv = (id = "c1", title = "My Conv"): Conversation => ({
  id,
  title,
  createdAt: "t",
  updatedAt: "t",
  mode: "single",
  plannerTag: "planner",
  executorTag: "executor",
  activeLeaf: "a2",
  messages: [msg("u1", null), msg("a1", "u1"), msg("a2", "u1")],
});

const makeSettings = (p: Partial<Settings> = {}): Settings => ({
  activeModelPath: "/home/u/models/foo.gguf",
  contextLimitWarning: true,
  generation: DEFAULT_GENERATION,
  modelOverrides: {},
  tags: [
    { name: "default", binding: "foo.gguf", params: {}, fallback: [] },
    { name: "planner", binding: null, params: {}, fallback: [] },
    { name: "executor", binding: null, params: {}, fallback: [] },
  ],
  ...p,
});

function makeDeps(opts: {
  folder?: string | null;
  file?: string | null;
  convs?: Conversation[];
  settings?: Settings;
}) {
  const convs = new Map(opts.convs?.map((c) => [c.id, c]) ?? []);
  let settings = opts.settings ?? makeSettings();
  const engine = { isGenerating: () => false } as unknown as EngineLike;
  const store: StoreLike = {
    getConversation: (id) => convs.get(id) ?? null,
    saveConversation: (c) => void convs.set(c.id, c),
    listConversations: () =>
      [...convs.values()].map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
      })),
    deleteConversation: (id) => convs.delete(id),
    getSettings: () => settings,
    saveSettings: (s) => void (settings = s),
  };
  const deps: HandlerDeps = {
    engine,
    emit: () => {},
    store,
    dialogs: {
      pickFolder: async () => opts.folder ?? null,
      pickFile: async () => opts.file ?? null,
    },
  };
  return {
    deps,
    convs,
    getSettings: () => settings,
    h: createRequestHandlers(deps),
  };
}

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "export-test-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const call = async <T>(p: Promise<T> | T): Promise<T> => p;

describe("conversation.export", () => {
  test("writes a JSON envelope that re-parses, to the picked folder", async () => {
    const dir = tmp();
    const { h } = makeDeps({ folder: dir, convs: [makeConv()] });
    const r = await call(
      h["conversation.export"]({ conversationId: "c1", format: "json" }),
    );
    expect(r.path).not.toBeNull();
    const env = parseEnvelope(readFileSync(r.path!, "utf8"));
    expect(env.formatVersion).toBe(EXPORT_FORMAT_VERSION);
    expect(env.kind).toBe("conversation");
    expect(env.conversations[0]!.id).toBe("c1");
    expect(env.conversations[0]!.messages).toHaveLength(3);
  });

  test("writes markdown with the active path only", async () => {
    const dir = tmp();
    const { h } = makeDeps({ folder: dir, convs: [makeConv()] });
    const r = await call(
      h["conversation.export"]({ conversationId: "c1", format: "markdown" }),
    );
    const md = readFileSync(r.path!, "utf8");
    expect(md).toContain("# My Conv");
    expect(md).toContain("content-u1");
    expect(md).toContain("content-a2"); // active leaf
    expect(md).not.toContain("content-a1"); // dead variant
  });

  test("cancelled picker returns {path:null}", async () => {
    const { h } = makeDeps({ folder: null, convs: [makeConv()] });
    const r = await call(
      h["conversation.export"]({ conversationId: "c1", format: "json" }),
    );
    expect(r.path).toBeNull();
  });

  test("missing conversation -> NOT_FOUND; bad format -> INVALID_PARAMS", async () => {
    const { h } = makeDeps({ folder: tmp(), convs: [] });
    try {
      await call(
        h["conversation.export"]({ conversationId: "nope", format: "json" }),
      );
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("NOT_FOUND");
    }
    try {
      await call(
        h["conversation.export"]({
          conversationId: "c1",
          format: "yaml" as never,
        }),
      );
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("INVALID_PARAMS");
    }
  });

  test("dedupes filename when the target exists", async () => {
    const dir = tmp();
    const { h } = makeDeps({ folder: dir, convs: [makeConv()] });
    const a = await call(
      h["conversation.export"]({ conversationId: "c1", format: "json" }),
    );
    const b = await call(
      h["conversation.export"]({ conversationId: "c1", format: "json" }),
    );
    expect(a.path).not.toBe(b.path);
    expect(b.path).toContain("-2.json");
  });
});

describe("conversation.import", () => {
  const writeExport = (dir: string, body: unknown): string => {
    const p = join(dir, "in.json");
    writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body));
    return p;
  };
  const envOf = (conv: Conversation) => ({
    formatVersion: 1,
    app: "ai-desktop-app",
    kind: "conversation",
    exportedAt: "t",
    conversations: [conv],
  });

  test("round-trip: export → import preserves tree with fresh ids", async () => {
    const dir = tmp();
    const conv = makeConv();
    const src = makeDeps({ folder: dir, convs: [conv] });
    const ex = await call(
      src.h["conversation.export"]({ conversationId: "c1", format: "json" }),
    );

    const dst = makeDeps({ file: ex.path });
    const im = await call(dst.h["conversation.import"]({}));
    expect(im.conversationId).not.toBeNull();
    const imported = dst.convs.get(im.conversationId!)!;
    // same shape, different ids
    expect(imported.id).not.toBe("c1");
    expect(imported.messages.map((m) => m.content)).toEqual(
      conv.messages.map((m) => m.content),
    );
    const byContent = new Map(imported.messages.map((m) => [m.content, m]));
    expect(byContent.get("content-a2")!.parentId).toBe(
      byContent.get("content-u1")!.id,
    );
    expect(imported.activeLeaf).toBe(byContent.get("content-a2")!.id);
  });

  test("collision: importing the same conv twice gives two rows, second titled (imported)", async () => {
    const dir = tmp();
    const file = writeExport(dir, envOf(makeConv()));
    const { h, convs } = makeDeps({ file, convs: [makeConv("orig", "My Conv")] });
    const a = await call(h["conversation.import"]({}));
    const b = await call(h["conversation.import"]({}));
    expect(convs.size).toBe(3);
    const titles = [...convs.values()].map((c) => c.title);
    expect(titles.filter((t) => t === "My Conv (imported)")).toHaveLength(2);
    expect(a.conversationId).not.toBe(b.conversationId);
  });

  test("malformed file -> INVALID_PARAMS and zero writes", async () => {
    const dir = tmp();
    const file = writeExport(dir, "not json at all {{{");
    const { h, convs } = makeDeps({ file });
    try {
      await call(h["conversation.import"]({}));
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("INVALID_PARAMS");
    }
    expect(convs.size).toBe(0);
  });

  test("backup envelope through conversation path -> INVALID_PARAMS", async () => {
    const dir = tmp();
    const file = writeExport(dir, { ...envOf(makeConv()), kind: "backup" });
    const { h, convs } = makeDeps({ file });
    try {
      await call(h["conversation.import"]({}));
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("INVALID_PARAMS");
      expect((e as EngineError).message).toContain("conversation");
    }
    expect(convs.size).toBe(0);
  });

  test("cancelled picker returns {conversationId:null}", async () => {
    const { h } = makeDeps({ file: null });
    expect((await call(h["conversation.import"]({}))).conversationId).toBeNull();
  });
});

describe("backup.export + backup.import", () => {
  test("round-trip into a fresh store restores convs + settings + tags", async () => {
    const dir = tmp();
    const src = makeDeps({
      folder: dir,
      convs: [makeConv(), makeConv("c2", "Second")],
      settings: makeSettings(),
    });
    const ex = await call(src.h["backup.export"]({}));
    expect(ex.path).not.toBeNull();
    const raw = readFileSync(ex.path!, "utf8");
    expect(raw).not.toContain("/home/u/models"); // FR-003: basename only
    const env = parseEnvelope(raw);
    expect(env.kind).toBe("backup");
    expect(env.settings?.activeModel).toBe("foo.gguf");
    expect(env.tags).toHaveLength(3);

    const dst = makeDeps({ file: ex.path, settings: makeSettings({ tags: [] }) });
    const r = await call(dst.h["backup.import"]({}));
    expect(r.imported).toBe(2);
    expect(dst.convs.size).toBe(2);
    const s = dst.getSettings();
    // absent model file -> activeModelPath null, binding kept (broken, FR-008)
    expect(s.activeModelPath).toBeNull();
    expect(s.tags.find((t) => t.name === "default")?.binding).toBe("foo.gguf");
    expect(s.tags.find((t) => t.name === "planner")).toBeDefined();
  });

  test("collision-safe: existing store keeps its convs, imports get fresh ids", async () => {
    const dir = tmp();
    const src = makeDeps({ folder: dir, convs: [makeConv()] });
    const ex = await call(src.h["backup.export"]({}));
    const dst = makeDeps({
      file: ex.path,
      convs: [makeConv("keep", "Existing")],
    });
    await call(dst.h["backup.import"]({}));
    expect(dst.convs.size).toBe(2);
    expect(dst.convs.get("keep")).toBeDefined();
  });

  test("malformed backup -> INVALID_PARAMS, store untouched", async () => {
    const dir = tmp();
    const file = join(dir, "bad.json");
    writeFileSync(file, "{bad json");
    const { h, convs } = makeDeps({ file, convs: [makeConv("x", "Keep")] });
    try {
      await call(h["backup.import"]({}));
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("INVALID_PARAMS");
    }
    expect(convs.size).toBe(1);
  });

  test("conversation envelope through backup path -> INVALID_PARAMS", async () => {
    const dir = tmp();
    const file = join(dir, "c.json");
    writeFileSync(
      file,
      JSON.stringify({
        formatVersion: 1,
        app: "ai-desktop-app",
        kind: "conversation",
        exportedAt: "t",
        conversations: [makeConv()],
      }),
    );
    const { h, convs } = makeDeps({ file });
    try {
      await call(h["backup.import"]({}));
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("INVALID_PARAMS");
    }
    expect(convs.size).toBe(0);
  });

  test("cancelled pickers return null results", async () => {
    const { h } = makeDeps({ folder: null, file: null });
    expect((await call(h["backup.export"]({}))).path).toBeNull();
    expect((await call(h["backup.import"]({}))).imported).toBeNull();
  });
});
