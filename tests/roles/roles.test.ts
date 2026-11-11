// Roles service contract: CRUD, slug validation, binding states, static
// resolve with fallback chain, consumer detection on delete (T004/T008).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoleError, RolesService } from "../../src/bun/models/roles";
import type { StoreLike } from "../../src/bun/rpc/handlers";
import type { Conversation, ModelMeta, Settings } from "../../src/shared/types";
import { DEFAULT_GENERATION } from "../../src/shared/types";

const dir = mkdtempSync(join(tmpdir(), "roles-"));
process.env.MODELS_DIR = dir;
writeFileSync(join(dir, "small.gguf"), "x");
writeFileSync(join(dir, "big.gguf"), "x");
writeFileSync(join(dir, "mid.gguf"), "x");

const meta = (fileName: string): ModelMeta => ({
  path: join(dir, fileName),
  fileName,
  sizeBytes: 1,
  name: fileName,
  architecture: null,
  paramCount: null,
  quantization: null,
  contextTrain: null,
});

function makeStore(settings?: Partial<Settings>) {
  const s: Settings = {
    activeModelPath: null,
    contextLimitWarning: false,
    generation: DEFAULT_GENERATION,
    modelOverrides: {},
    tags: [],
    ...settings,
  };
  const convs = new Map<string, Conversation>();
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
    getSettings: () => s,
    saveSettings: (next) => Object.assign(s, next),
  };
  return { store, settings: s, convs };
}

function svc(store: StoreLike) {
  return new RolesService({
    store,
    scan: () => ["small.gguf", "big.gguf", "mid.gguf"].map(meta),
  });
}

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof RoleError) return e.code;
    throw e;
  }
  return "";
};

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("RolesService", () => {
  test("create validates slug and uniqueness", () => {
    const { store } = makeStore();
    const r = svc(store);
    expect(code(() => r.create({ name: "Bad Name!" }))).toBe("INVALID_PARAMS");
    expect(code(() => r.create({ name: "-lead" }))).toBe("INVALID_PARAMS");
    const tag = r.create({ name: "writer", label: "Writer" });
    expect(tag.binding).toBeNull();
    expect(code(() => r.create({ name: "writer" }))).toBe("ALREADY_EXISTS");
  });

  test("bind sets library file; missing file -> MODEL_NOT_FOUND", () => {
    const { store } = makeStore();
    const r = svc(store);
    r.create({ name: "writer" });
    expect(code(() => r.bind("writer", "nope.gguf"))).toBe("MODEL_NOT_FOUND");
    r.bind("writer", "small.gguf");
    expect(store.getSettings().tags[0]!.binding).toBe("small.gguf");
  });

  test("list derives bound/unbound/broken states", () => {
    const { store } = makeStore();
    const r = svc(store);
    r.create({ name: "a" });
    r.create({ name: "b" });
    r.bind("b", "small.gguf");
    r.create({ name: "c" });
    // corrupt c's binding to a nonexistent file directly
    store.getSettings().tags[2]!.binding = "ghost.gguf";
    const states = Object.fromEntries(
      r.list().map((t) => [t.name, t.state]),
    );
    expect(states).toEqual({ a: "unbound", b: "bound", c: "broken" });
    expect(r.list().find((t) => t.name === "b")!.resolvedFile?.fileName).toBe(
      "small.gguf",
    );
  });

  test("resolve: primary binding wins; params cascade tag over file", () => {
    const { store, settings } = makeStore();
    settings.modelOverrides = { "small.gguf": { temperature: 0.5 } };
    const r = svc(store);
    r.create({ name: "writer" });
    r.update({ name: "writer", params: { temperature: 0.9 } });
    r.bind("writer", "small.gguf");
    const res = r.resolve("writer");
    expect(res.fileName).toBe("small.gguf");
    expect(res.servedBy).toEqual({ kind: "primary" });
    expect(res.params.temperature).toBe(0.9); // tag beats file override
  });

  test("resolve falls back through chain: model ref then nested tag", () => {
    const { store } = makeStore();
    const r = svc(store);
    r.create({ name: "backup" });
    r.bind("backup", "mid.gguf");
    r.create({ name: "main" });
    r.setFallback("main", [
      { kind: "model", fileName: "missing.gguf" },
      { kind: "tag", name: "backup" },
    ]);
    const res = r.resolve("main");
    expect(res.fileName).toBe("mid.gguf");
    expect(res.servedBy).toEqual({
      kind: "fallback",
      via: { kind: "tag", name: "backup" },
    });
  });

  test("resolveCandidates returns the full ordered list for runtime cascade", () => {
    const { store } = makeStore();
    const r = svc(store);
    r.create({ name: "main" });
    r.setFallback("main", [
      { kind: "model", fileName: "missing.gguf" }, // lazy skip
      { kind: "model", fileName: "mid.gguf" },
      { kind: "model", fileName: "small.gguf" },
    ]);
    // unbound primary: only fallbacks list
    let cands = r.resolveCandidates("main");
    expect(cands.map((c) => c.fileName)).toEqual(["mid.gguf", "small.gguf"]);
    expect(cands.every((c) => c.servedBy.kind === "fallback")).toBe(true);
    // bound primary leads the list
    r.bind("main", "big.gguf");
    cands = r.resolveCandidates("main");
    expect(cands.map((c) => c.fileName)).toEqual([
      "big.gguf",
      "mid.gguf",
      "small.gguf",
    ]);
    expect(cands[0]!.servedBy.kind).toBe("primary");
    // nothing resolvable -> empty list (resolve() still throws)
    r.create({ name: "empty" });
    expect(r.resolveCandidates("empty")).toEqual([]);
    expect(() => r.resolve("empty")).toThrow(RoleError);
  });

  test("resolve throws ROLE_UNBOUND when nothing resolves", () => {
    const { store } = makeStore();
    const r = svc(store);
    r.create({ name: "empty" });
    expect(code(() => r.resolve("empty"))).toBe("ROLE_UNBOUND");
  });

  test("setFallback validates length, self-ref, cycles, unknown refs", () => {
    const { store } = makeStore();
    const r = svc(store);
    r.create({ name: "x" });
    r.create({ name: "y" });
    expect(
      code(() => r.setFallback("x", Array(4).fill({ kind: "tag", name: "y" }))),
    ).toBe("INVALID_PARAMS");
    expect(
      code(() => r.setFallback("x", [{ kind: "tag", name: "x" }])),
    ).toBe("INVALID_PARAMS");
    expect(
      code(() => r.setFallback("x", [{ kind: "tag", name: "ghost" }])),
    ).toBe("NOT_FOUND");
    expect(
      code(() => r.setFallback("x", [{ kind: "model", fileName: "no.bin" }])),
    ).toBe("INVALID_PARAMS");
    // lazy model refs: not-yet-downloaded files are allowed (resolve skips)
    r.setFallback("x", [{ kind: "model", fileName: "future.gguf" }]);
    // cycle: x -> y -> x
    r.setFallback("x", [{ kind: "tag", name: "y" }]);
    expect(
      code(() => r.setFallback("y", [{ kind: "tag", name: "x" }])),
    ).toBe("INVALID_PARAMS");
  });

  test("delete reports ROLE_IN_USE and force detaches consumers", () => {
    const { store, convs } = makeStore();
    const r = svc(store);
    r.create({ name: "planner" });
    r.create({ name: "other" });
    r.setFallback("other", [{ kind: "tag", name: "planner" }]);
    convs.set("c1", {
      id: "c1",
      title: "t",
      createdAt: "x",
      updatedAt: "x",
      messages: [],
      mode: "fusion",
      plannerTag: "planner",
      executorTag: "other",
    });
    const err = code(() => r.delete("planner"));
    expect(err).toBe("ROLE_IN_USE");
    r.delete("planner", true);
    const conv = convs.get("c1")!;
    expect(conv.plannerTag).toBe("default");
    expect(
      store.getSettings().tags.find((t) => t.name === "other")!.fallback,
    ).toEqual([]);
    expect(
      store.getSettings().tags.some((t) => t.name === "planner"),
    ).toBe(false);
  });

  test("default bind syncs activeModelPath both ways", () => {
    const { store, settings } = makeStore();
    settings.tags = [
      {
        name: "default",
        binding: null,
        params: {},
        fallback: [],
      },
    ];
    const r = svc(store);
    r.bind("default", "small.gguf");
    expect(settings.activeModelPath).toBe(join(dir, "small.gguf"));
    r.bind("default", null);
    expect(settings.activeModelPath).toBeNull();
  });
});
