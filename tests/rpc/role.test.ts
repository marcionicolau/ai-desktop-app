// role.* RPC contract (contracts/rpc.md): request shapes, error codes,
// role.changed emission after mutations (T007/T010).
import { describe, expect, test } from "bun:test";
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

const dir = mkdtempSync(join(tmpdir(), "role-rpc-"));
process.env.MODELS_DIR = dir;
writeFileSync(join(dir, "a.gguf"), "x");
writeFileSync(join(dir, "b.gguf"), "x");

function makeDeps() {
  const emitted: { method: string; payload: unknown }[] = [];
  const settings: Settings = {
    activeModelPath: null,
    contextLimitWarning: false,
    generation: DEFAULT_GENERATION,
    modelOverrides: {},
    tags: [
      { name: "default", binding: null, params: {}, fallback: [] },
      { name: "planner", binding: null, params: {}, fallback: [] },
      { name: "executor", binding: null, params: {}, fallback: [] },
    ],
  };
  const convs = new Map<string, Conversation>();
  const store: StoreLike = {
    getConversation: (id) => convs.get(id) ?? null,
    saveConversation: (c) => void convs.set(c.id, c),
    listConversations: () => [],
    deleteConversation: (id) => convs.delete(id),
    getSettings: () => settings,
    saveSettings: (next) => Object.assign(settings, next),
  };
  const engine: EngineLike = {
    status: () => ({ status: "ready", name: "a.gguf" }),
    loadModel: async (p: string) => ({ status: "ready", name: p }),
    unloadModel: () => {},
    isGenerating: () => false,
    contextSize: () => 4096,
    chatTemplate: () => null,
    tokenCount: (t: string) => t.length,
    generate: async () => ({
      status: "complete",
      tokens: 0,
      elapsedMs: 1,
      warm: false,
    }),
    stop: () => {},
  };
  const roles = new RolesService({
    store,
    scan: () => [],
  });
  const deps = {
    engine,
    store,
    roles,
    emit: (m: string, p: unknown) => emitted.push({ method: m, payload: p }),
  };
  return {
    deps: deps as never,
    emitted,
    settings,
    call: (method: string, params: Record<string, unknown>) =>
      (createRequestHandlers(deps) as never)[method](params),
  };
}

describe("role.* contract", () => {
  test("role.list returns tags with derived state", () => {
    const { call } = makeDeps();
    const res = call("role.list", {}) as { tags: { name: string; state: string }[] };
    const names = res.tags.map((t) => t.name);
    expect(names).toContain("default");
    expect(res.tags.every((t) => t.state === "unbound")).toBe(true);
  });

  test("role.create validates slug, returns tag, emits role.changed", () => {
    const { call, emitted } = makeDeps();
    const res = call("role.create", { name: "writer" }) as {
      tag: { name: string };
    };
    expect(res.tag.name).toBe("writer");
    expect(
      emitted.some(
        (e) => e.method === "role.changed" && e.payload.name === "writer",
      ),
    ).toBe(true);
    expect(() => call("role.create", { name: "Bad!" })).toThrow();
  });

  test("role.bind syncs default -> activeModelPath; missing -> MODEL_NOT_FOUND", () => {
    const { call, settings } = makeDeps();
    expect(() => call("role.bind", { name: "default", fileName: "no.gguf" }))
      .toThrow();
    call("role.bind", { name: "default", fileName: "a.gguf" });
    expect(settings.activeModelPath).toBe(join(dir, "a.gguf"));
  });

  test("role.resolve returns ResolvedRole or ROLE_UNBOUND", () => {
    const { call } = makeDeps();
    call("role.bind", { name: "planner", fileName: "b.gguf" });
    const res = call("role.resolve", { name: "planner" }) as {
      resolved: { fileName: string; servedBy: { kind: string } };
    };
    expect(res.resolved.fileName).toBe("b.gguf");
    expect(res.resolved.servedBy.kind).toBe("primary");
    expect(() => call("role.resolve", { name: "executor" })).toThrow();
  });

  test("model.download rejects unknown tagName upfront (NOT_FOUND)", () => {
    const { call } = makeDeps();
    expect(() =>
      call("model.download", {
        url: "https://huggingface.co/o/r/resolve/main/m.gguf",
        fileName: "m.gguf",
        tagName: "ghost",
      }),
    ).toThrow();
  });

  test("role.setFallback + delete ROLE_IN_USE semantics", () => {
    const { call } = makeDeps();
    call("role.bind", { name: "executor", fileName: "a.gguf" });
    call("role.setFallback", {
      name: "planner",
      chain: [{ kind: "tag", name: "executor" }],
    });
    expect(() => call("role.delete", { name: "executor" })).toThrow();
    call("role.delete", { name: "executor", force: true });
  });
});
