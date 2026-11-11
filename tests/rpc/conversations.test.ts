// conversation.* contract test (contracts/rpc.md): create/list/get/rename/
// delete + NOT_FOUND / EMPTY_TITLE error codes.
import { describe, expect, test } from "bun:test";
import { EngineError } from "../../src/bun/llama/engine";
import {
  createRequestHandlers,
  type EngineLike,
  type HandlerDeps,
  type StoreLike,
} from "../../src/bun/rpc/handlers";
import type { Conversation, Settings } from "../../src/shared/types";

function makeDeps() {
  const convs = new Map<string, Conversation>();
  const engine: EngineLike = {
    status: () => ({ status: "unloaded" }),
    loadModel: async () => ({ status: "ready" as const, name: "f.gguf" }),
    unloadModel: () => {},
    isGenerating: () => false,
    generate: async () => "complete",
    stop: () => {},
  };
  const store: StoreLike = {
    getConversation: (id) => convs.get(id) ?? null,
    saveConversation: (c) => void convs.set(c.id, { ...c }),
    listConversations: () =>
      [...convs.values()]
        .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    deleteConversation: (id) => convs.delete(id),
    getSettings: () =>
      ({ activeModelPath: null, contextLimitWarning: false }) as Settings,
    saveSettings: () => {},
  };
  const deps: HandlerDeps = { engine, store, emit: () => {} };
  return { deps, convs };
}

describe("conversation.* contract", () => {
  test("create -> get round-trip", () => {
    const { deps } = makeDeps();
    const h = createRequestHandlers(deps);
    const s = h["conversation.create"]({ title: "My chat" });
    const conv = h["conversation.get"]({ conversationId: s.id });
    expect(conv.title).toBe("My chat");
    expect(conv.messages).toEqual([]);
  });

  test("create without title defaults non-empty", () => {
    const { deps } = makeDeps();
    const h = createRequestHandlers(deps);
    const s = h["conversation.create"]({});
    expect(s.title.length).toBeGreaterThan(0);
  });

  test("list returns summaries of all conversations", () => {
    const { deps } = makeDeps();
    const h = createRequestHandlers(deps);
    h["conversation.create"]({ title: "A" });
    h["conversation.create"]({ title: "B" });
    const list = h["conversation.list"]({});
    expect(list.length).toBe(2);
    expect(list.map((s) => s.title).sort()).toEqual(["A", "B"]);
  });

  test("rename updates title; whitespace title -> EMPTY_TITLE", () => {
    const { deps, convs } = makeDeps();
    const h = createRequestHandlers(deps);
    const s = h["conversation.create"]({ title: "Old" });
    h["conversation.rename"]({ conversationId: s.id, title: "New" });
    expect(convs.get(s.id)!.title).toBe("New");
    try {
      h["conversation.rename"]({ conversationId: s.id, title: "  " });
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("EMPTY_TITLE");
    }
  });

  test("get/rename/delete on missing id -> NOT_FOUND", () => {
    const { deps } = makeDeps();
    const h = createRequestHandlers(deps);
    const missing = { conversationId: "nope" };
    for (const call of [
      () => h["conversation.get"](missing),
      () => h["conversation.rename"]({ ...missing, title: "x" }),
      () => h["conversation.delete"](missing),
    ]) {
      try {
        call();
        expect.unreachable();
      } catch (e) {
        expect((e as EngineError).code).toBe("NOT_FOUND");
      }
    }
  });

  test("delete removes the conversation", () => {
    const { deps, convs } = makeDeps();
    const h = createRequestHandlers(deps);
    const s = h["conversation.create"]({});
    h["conversation.delete"]({ conversationId: s.id });
    expect(convs.has(s.id)).toBe(false);
  });
});
