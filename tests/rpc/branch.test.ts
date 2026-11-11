// Branching contract (contracts/rpc.md, feature 005): regenerate/edit
// create siblings, activeLeaf tracks the displayed branch,
// message.selectVariant navigates, ENGINE_BUSY gates switching.
import { describe, expect, test } from "bun:test";
import { EngineError } from "../../src/bun/llama/engine";
import {
  createRequestHandlers,
  type EngineLike,
  type HandlerDeps,
  type StoreLike,
} from "../../src/bun/rpc/handlers";
import type { Conversation, Message, Settings } from "../../src/shared/types";
import { DEFAULT_GENERATION } from "../../src/shared/types";

function makeDeps(opts: { generating?: boolean; tokens?: string[] } = {}) {
  const emitted: { method: string; payload: unknown }[] = [];
  const convs = new Map<string, Conversation>();
  let generating = opts.generating ?? false;

  const engine: EngineLike = {
    status: () => ({ status: "ready" as const, name: "fake.gguf" }),
    loadModel: async () => ({ status: "ready" as const, name: "fake.gguf" }),
    unloadModel: () => {},
    isGenerating: () => generating,
    contextSize: () => 4096,
    chatTemplate: () => null,
    tokenCount: (t: string) => Math.ceil(t.length / 4),
    stop: () => {
      generating = false;
    },
    generate: async (_p, onToken) => {
      generating = true;
      let tokens = 0;
      for (const t of opts.tokens ?? ["ok"]) {
        tokens += 1;
        onToken(t);
        await new Promise((r) => setTimeout(r, 0));
      }
      generating = false;
      return { status: "complete" as const, tokens, elapsedMs: 1, warm: false };
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
    emit: (m, p) => emitted.push({ method: m, payload: p }),
  };
  return { deps, emitted, convs };
}

const CONV = "conv-1";
const flush = () => new Promise((r) => setTimeout(r, 10));

function send(h: ReturnType<typeof createRequestHandlers>, text: string) {
  const { messageId } = h["chat.send"]({ conversationId: CONV, content: text });
  return messageId;
}

describe("chat.regenerate -> sibling variant", () => {
  test("creates a new sibling; original preserved verbatim incl. stats", async () => {
    const { deps, convs } = makeDeps({ tokens: ["v1"] });
    const h = createRequestHandlers(deps);
    const a1 = send(h, "hi");
    await flush();
    const original = convs.get(CONV)!.messages.find((m) => m.id === a1)!;
    original.stats = { tokens: 3, tokensPerSec: 9 };
    original.phases = { plan: { content: "p", tag: "planner", fileName: "f.gguf" } };

    const { messageId: a2 } = h["chat.regenerate"]({ messageId: a1 });
    await flush();

    const conv = convs.get(CONV)!;
    expect(a2).not.toBe(a1);
    const sibling = conv.messages.find((m) => m.id === a2)!;
    expect(sibling.parentId).toBe(original.parentId); // same parent = variant set
    expect(sibling.role).toBe("assistant");
    expect(sibling.content).toBe("v1"); // fake engine emits "ok" x1? tokens ["v1"]
    // original untouched per FR-009 (content/status/stats/phases intact)
    expect(original.content).toBe("v1");
    expect(original.status).toBe("complete");
    expect(original.stats).toEqual({ tokens: 3, tokensPerSec: 9 });
    expect(original.phases?.plan?.content).toBe("p");
    // active leaf moved to the new variant
    expect(conv.activeLeaf).toBe(a2);
  });

  test("second regenerate yields 3 variants; selectVariant round-trips", async () => {
    const { deps, convs } = makeDeps({});
    const h = createRequestHandlers(deps);
    const a1 = send(h, "hi");
    await flush();
    const { messageId: a2 } = h["chat.regenerate"]({ messageId: a1 });
    await flush();
    const { messageId: a3 } = h["chat.regenerate"]({ messageId: a2 });
    await flush();

    const conv = convs.get(CONV)!;
    const assistants = conv.messages.filter((m) => m.role === "assistant");
    expect(assistants.map((m) => m.id)).toEqual([a1, a2, a3]);
    expect(conv.activeLeaf).toBe(a3);

    const r1 = h["message.selectVariant"]({ messageId: a1 });
    expect(r1.activeLeaf).toBe(a1);
    const r2 = h["message.selectVariant"]({ messageId: a3 });
    expect(r2.activeLeaf).toBe(a3);
    expect(convs.get(CONV)!.activeLeaf).toBe(a3);
  });

  test("regenerating a non-active variant is NOT_FOUND", async () => {
    const { deps } = makeDeps({});
    const h = createRequestHandlers(deps);
    const a1 = send(h, "hi");
    await flush();
    const { messageId: a2 } = h["chat.regenerate"]({ messageId: a1 });
    await flush();
    // a1 is now a leaf but off the active path
    try {
      h["chat.regenerate"]({ messageId: a1 });
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("NOT_FOUND");
    }
    // newest variant still regenerates
    const { messageId: a3 } = h["chat.regenerate"]({ messageId: a2 });
    expect(a3).not.toBe(a2);
    await flush();
  });

  test("partial/failed variant regenerates into a sibling (kept, not reset)", async () => {
    const { deps, convs } = makeDeps({});
    const h = createRequestHandlers(deps);
    const a1 = send(h, "hi");
    await flush();
    const original = convs.get(CONV)!.messages.find((m) => m.id === a1)!;
    original.status = "partial"; // simulate stopped generation
    original.content = "half";

    const { messageId: a2 } = h["chat.regenerate"]({ messageId: a1 });
    await flush();
    expect(original.status).toBe("partial");
    expect(original.content).toBe("half");
    expect(
      convs.get(CONV)!.messages.filter((m) => m.role === "assistant"),
    ).toHaveLength(2);
    expect(a2).not.toBe(a1);
  });
});

describe("message.selectVariant", () => {
  test("selects the deepest descendant of a mid-path message", async () => {
    const { deps, convs } = makeDeps({});
    const h = createRequestHandlers(deps);
    const a1 = send(h, "hi");
    await flush();
    const conv = convs.get(CONV)!;
    const u1 = conv.messages[0]!;
    // branch a sibling then re-select the user turn -> deepest leaf = a2
    const { messageId: a2 } = h["chat.regenerate"]({ messageId: a1 });
    await flush();
    const r = h["message.selectVariant"]({ messageId: u1.id });
    expect(r.activeLeaf).toBe(a2);
  });

  test("rejects unknown message and variant switching while generating", () => {
    const { deps } = makeDeps({});
    const h = createRequestHandlers(deps);
    try {
      h["message.selectVariant"]({ messageId: "nope" });
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("NOT_FOUND");
    }
    const busy = makeDeps({ generating: true });
    const hb = createRequestHandlers(busy.deps);
    busy.convs.set(CONV, {
      id: CONV,
      title: "t",
      createdAt: "t",
      updatedAt: "t",
      messages: [
        {
          id: "m1",
          conversationId: CONV,
          role: "user",
          content: "x",
          status: "complete",
          createdAt: "t",
          completedAt: "t",
        } as Message,
      ],
      mode: "single",
      plannerTag: "planner",
      executorTag: "executor",
    });
    try {
      hb["message.selectVariant"]({ messageId: "m1" });
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("ENGINE_BUSY");
    }
  });
});

describe("chat.edit -> user sibling + fresh child", () => {
  test("original user message + whole subtree preserved (FR-002)", async () => {
    const { deps, convs } = makeDeps({});
    const h = createRequestHandlers(deps);
    send(h, "original q");
    await flush();
    send(h, "follow-up");
    await flush();

    const conv = convs.get(CONV)!;
    const u1 = conv.messages[0]!;
    const a1 = conv.messages[1]!;

    const { messageId: aNew } = h["chat.edit"]({
      messageId: u1.id,
      content: "edited q",
    });
    await flush();

    const after = convs.get(CONV)!;
    // original user msg intact, its descendants still in the tree
    expect(u1.content).toBe("original q");
    expect(u1.status).toBe("complete");
    expect(a1.parentId).toBe(u1.id);
    // 4 original msgs + user variant + new assistant
    expect(after.messages).toHaveLength(6);
    const userVariant = after.messages.find(
      (m) => m.role === "user" && m.content === "edited q",
    )!;
    expect(userVariant.parentId).toBe(u1.parentId ?? null);
    const newAssistant = after.messages.find((m) => m.id === aNew)!;
    expect(newAssistant.parentId).toBe(userVariant.id);
    expect(after.activeLeaf).toBe(aNew);
  });

  test("switching the user variant swaps the displayed subtree", async () => {
    const { deps, convs } = makeDeps({ tokens: ["A"] });
    const h = createRequestHandlers(deps);
    const a1 = send(h, "q1");
    await flush();
    const conv = convs.get(CONV)!;
    const u1 = conv.messages[0]!;

    const { messageId: a2 } = h["chat.edit"]({ messageId: u1.id, content: "q2" });
    await flush();
    expect(convs.get(CONV)!.activeLeaf).toBe(a2);

    // select the original user turn -> deepest leaf under it is a1
    const r = h["message.selectVariant"]({ messageId: u1.id });
    expect(r.activeLeaf).toBe(a1);
    // selecting the edited user turn returns to the new subtree
    const edited = convs
      .get(CONV)!
      .messages.find((m) => m.role === "user" && m.content === "q2")!;
    const r2 = h["message.selectVariant"]({ messageId: edited.id });
    expect(r2.activeLeaf).toBe(a2);
  });

  test("send continues from the displayed variant, not siblings", async () => {
    const { deps, convs } = makeDeps({});
    const h = createRequestHandlers(deps);
    send(h, "v1 question");
    await flush();
    const conv = convs.get(CONV)!;
    const u1 = conv.messages[0]!;
    const a1 = conv.messages[1]!;

    h["chat.edit"]({ messageId: u1.id, content: "v2 question" });
    await flush();
    // send on the v2 branch: new user msg parents to its leaf, not a1
    send(h, "next on v2");
    await flush();
    const msgs = convs.get(CONV)!.messages;
    const newUser = msgs.find((m) => m.content === "next on v2")!;
    expect(newUser.parentId).not.toBe(a1.id);
    // parent must be the v2 branch's leaf assistant
    const parent = msgs.find((m) => m.id === newUser.parentId)!;
    expect(parent.role).toBe("assistant");
    expect(parent.parentId).toBe(
      msgs.find((m) => m.role === "user" && m.content === "v2 question")!.id,
    );
  });
});
