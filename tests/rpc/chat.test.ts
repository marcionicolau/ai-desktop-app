// RPC contract test (contracts/rpc.md): event ordering, ENGINE_BUSY,
// EMPTY_MESSAGE, chat.stop -> chat.done{status:"partial"}, NOT_GENERATING.
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

function makeDeps(opts: {
  generating?: boolean;
  status?: "ready" | "unloaded";
  genResult?: "complete" | "partial";
  genError?: Error;
  tokens?: string[];
  ctxSize?: number;
  onStop?: () => void;
}) {
  const emitted: { method: string; payload: unknown }[] = [];
  const convs = new Map<string, Conversation>();
  let generating = opts.generating ?? false;
  let stopped = false;
  let lastParams: unknown = null;
  let lastPrompt = "";

  const engine: EngineLike = {
    status: () => ({
      status: opts.status ?? "ready",
      name: "fake.gguf",
    }),
    loadModel: async () => ({ status: "ready" as const, name: "fake.gguf" }),
    unloadModel: () => {},
    isGenerating: () => generating,
    contextSize: () => opts.ctxSize ?? 4096,
    chatTemplate: () => null,
    tokenCount: (t: string) => Math.ceil(t.length / 4),
    stop: () => {
      stopped = true;
      opts.onStop?.();
    },
    generate: async (prompt, onToken, params) => {
      lastPrompt = prompt;
      lastParams = params ?? null;
      generating = true;
      let tokens = 0;
      for (const t of opts.tokens ?? ["a", "b", "c"]) {
        if (stopped) break;
        tokens += 1;
        onToken(t);
        // suspend like the real engine's event-loop yield
        await new Promise((r) => setTimeout(r, 0));
      }
      generating = false;
      if (opts.genError) throw opts.genError;
      return {
        status: stopped ? "partial" : (opts.genResult ?? "complete"),
        tokens,
        elapsedMs: 1,
        warm: false,
      };
    },
  };

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
    getSettings: () =>
      ({
        activeModelPath: null,
        contextLimitWarning: false,
        generation: DEFAULT_GENERATION,
        modelOverrides: {},
      }) as Settings,
    saveSettings: () => {},
  };

  const deps: HandlerDeps = {
    engine,
    store,
    emit: (method, payload) => emitted.push({ method, payload }),
  };
  return { deps, emitted, convs, engine, getLastPrompt: () => lastPrompt };
}

const CONV = "conv-1";
const flush = () => new Promise((r) => setTimeout(r, 10));

describe("chat.send contract", () => {
  test("emits ordered chat.token deltas then chat.done", async () => {
    const { deps, emitted, convs } = makeDeps({ tokens: ["Hel", "lo", "!"] });
    const h = createRequestHandlers(deps);
    const { messageId } = h["chat.send"]({ conversationId: CONV, content: "Hi" });
    await flush();

    const methods = emitted.map((e) => e.method);
    expect(methods).toEqual([
      "chat.token",
      "chat.token",
      "chat.token",
      "chat.done",
    ]);
    expect(
      (emitted.at(-1)!.payload as { status: string }).status,
    ).toBe("complete");
    const conv = convs.get(CONV)!;
    const assistant = conv.messages.at(-1)!;
    expect(assistant.id).toBe(messageId);
    expect(assistant.content).toBe("Hello!");
    expect(assistant.status).toBe("complete");
    expect(assistant.completedAt).not.toBeNull();
  });

  test("rejects empty/whitespace message with EMPTY_MESSAGE", () => {
    const { deps } = makeDeps({});
    const h = createRequestHandlers(deps);
    try {
      h["chat.send"]({ conversationId: CONV, content: "   " });
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("EMPTY_MESSAGE");
    }
  });

  test("rejects concurrent send with ENGINE_BUSY", () => {
    const { deps } = makeDeps({ generating: true });
    const h = createRequestHandlers(deps);
    try {
      h["chat.send"]({ conversationId: CONV, content: "Hi" });
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("ENGINE_BUSY");
    }
  });

  test("rejects send with NO_MODEL when unloaded", () => {
    const { deps } = makeDeps({ status: "unloaded" });
    const h = createRequestHandlers(deps);
    try {
      h["chat.send"]({ conversationId: CONV, content: "Hi" });
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("NO_MODEL");
    }
  });

  test("over-limit history emits chat.warning and drops oldest turns (FR-011)", async () => {
    // ctxSize 520 -> reserve 260 -> budget 1040 chars; seed a 2000-char turn
    const { deps, emitted, convs, getLastPrompt } = makeDeps({ ctxSize: 520 });
    convs.set(CONV, {
      id: CONV,
      title: "seed",
      createdAt: "t",
      updatedAt: "t",
      messages: [
        {
          id: "m1",
          conversationId: CONV,
          role: "user",
          content: "old-question-" + "x".repeat(2000),
          status: "complete",
          createdAt: "t",
          completedAt: "t",
        },
      ],
    });
    const h = createRequestHandlers(deps);
    const { messageId } = h["chat.send"]({ conversationId: CONV, content: "hi" });
    await flush();
    const warning = emitted.find((e) => e.method === "chat.warning");
    expect(warning).toBeDefined();
    const payload = warning!.payload as { messageId: string; code: string };
    expect(payload.messageId).toBe(messageId);
    expect(payload.code).toBe("CONTEXT_TRUNCATED");
    // oldest turn dropped; current message kept
    expect(getLastPrompt()).toContain("hi");
    expect(getLastPrompt()).not.toContain("old-question");
  });
});

describe("chat.stop contract", () => {
  test("stop during generation resolves chat.done partial", async () => {
    const { deps, emitted } = makeDeps({ tokens: ["a", "b", "c", "d", "e"] });
    const h = createRequestHandlers(deps);
    const { messageId } = h["chat.send"]({ conversationId: CONV, content: "Hi" });
    // generation is in-flight here (fake suspends between tokens)
    const res = h["chat.stop"]({ messageId });
    expect(res).toEqual({});
    await flush();
    const done = emitted.find((e) => e.method === "chat.done");
    expect((done?.payload as { status: string }).status).toBe("partial");
  });

  test("stop with no active generation rejects NOT_GENERATING", () => {
    const { deps } = makeDeps({ generating: false });
    const h = createRequestHandlers(deps);
    try {
      h["chat.stop"]({ messageId: "nope" });
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("NOT_GENERATING");
    }
  });
});
