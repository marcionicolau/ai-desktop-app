// model.* contract test (contracts/rpc.md): error codes, progress events,
// unload -> chat.send NO_MODEL.
import { describe, expect, test } from "bun:test";
import { EngineError } from "../../src/bun/llama/engine";
import {
  createRequestHandlers,
  type EngineLike,
  type HandlerDeps,
  type StoreLike,
} from "../../src/bun/rpc/handlers";
import type { Conversation, Settings } from "../../src/shared/types";
import { DEFAULT_GENERATION } from "../../src/shared/types";

function makeDeps(loadBehavior: "ok" | "not_found" | "invalid") {
  const emitted: { method: string; payload: unknown }[] = [];
  const convs = new Map<string, Conversation>();
  const savedSettings: Settings[] = [];
  let loaded = false;

  const engine: EngineLike = {
    status: () => ({
      status: loaded ? "ready" : "unloaded",
      name: loaded ? "fake.gguf" : undefined,
    }),
    loadModel: async (path) => {
      if (loadBehavior === "not_found") {
        throw new EngineError("MODEL_NOT_FOUND", `not found: ${path}`);
      }
      if (loadBehavior === "invalid") {
        throw new EngineError("MODEL_INVALID", `invalid: ${path}`);
      }
      loaded = true;
      return { status: "ready" as const, name: "fake.gguf" };
    },
    unloadModel: () => {
      loaded = false;
    },
    isGenerating: () => false,
    contextSize: () => 4096,
    chatTemplate: () => null,
    generate: async () => ({ status: "complete" as const, tokens: 1, elapsedMs: 1 }),
    stop: () => {},
  };

  const store: StoreLike = {
    getConversation: (id) => convs.get(id) ?? null,
    saveConversation: (c) => void convs.set(c.id, c),
    listConversations: () => [],
    deleteConversation: (id) => convs.delete(id),
    getSettings: () =>
      ({
        activeModelPath: null,
        contextLimitWarning: false,
        generation: DEFAULT_GENERATION,
        modelOverrides: {},
      }) as Settings,
    saveSettings: (s) => void savedSettings.push(s),
  };

  const deps: HandlerDeps = {
    engine,
    store,
    emit: (m, p) => emitted.push({ method: m, payload: p }),
  };
  return { deps, emitted, savedSettings };
}

describe("model.* contract", () => {
  test("model.load missing path -> MODEL_NOT_FOUND + progress error", async () => {
    const { deps, emitted } = makeDeps("not_found");
    const h = createRequestHandlers(deps);
    try {
      await h["model.load"]({ path: "/nope.gguf" });
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("MODEL_NOT_FOUND");
    }
    const phases = emitted.map((e) => (e.payload as { phase: string }).phase);
    expect(phases).toEqual(["loading", "error"]);
  });

  test("model.load corrupt file -> MODEL_INVALID", async () => {
    const { deps } = makeDeps("invalid");
    const h = createRequestHandlers(deps);
    try {
      await h["model.load"]({ path: "/corrupt.gguf" });
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("MODEL_INVALID");
    }
  });

  test("model.load success emits loading -> ready and persists path", async () => {
    const { deps, emitted, savedSettings } = makeDeps("ok");
    const h = createRequestHandlers(deps);
    const res = await h["model.load"]({ path: "/models/fake.gguf" });
    expect(res.status).toBe("ready");
    const phases = emitted.map((e) => (e.payload as { phase: string }).phase);
    expect(phases).toEqual(["loading", "ready"]);
    expect(savedSettings.at(-1)!.activeModelPath).toBe("/models/fake.gguf");
  });

  test("model.unload then chat.send -> NO_MODEL; unload clears activeModelPath", async () => {
    const { deps, savedSettings } = makeDeps("ok");
    const h = createRequestHandlers(deps);
    await h["model.load"]({ path: "/models/fake.gguf" });
    h["model.unload"]({});
    expect(savedSettings.at(-1)!.activeModelPath).toBeNull();
    try {
      h["chat.send"]({ conversationId: "c1", content: "hi" });
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("NO_MODEL");
    }
  });
});
