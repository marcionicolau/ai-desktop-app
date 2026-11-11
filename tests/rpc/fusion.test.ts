// conversation.setMode contract (T016): fusion gating names the missing
// role; mode/tags persist on the conversation.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RolesService } from "../../src/bun/models/roles";
import { ModelRegistry, type SlotEngine } from "../../src/bun/models/registry";
import {
  createRequestHandlers,
  type EngineLike,
  type StoreLike,
} from "../../src/bun/rpc/handlers";
import type { Conversation, Settings } from "../../src/shared/types";
import { DEFAULT_GENERATION } from "../../src/shared/types";

const dir = mkdtempSync(join(tmpdir(), "fusion-rpc-"));
process.env.MODELS_DIR = dir;
writeFileSync(join(dir, "p.gguf"), "x");
writeFileSync(join(dir, "e.gguf"), "x");

function makeDeps() {
  const emitted: { method: string; payload: unknown }[] = [];
  const settings: Settings = {
    activeModelPath: null,
    contextLimitWarning: false,
    generation: DEFAULT_GENERATION,
    modelOverrides: {},
    tags: [
      { name: "default", binding: "e.gguf", params: {}, fallback: [] },
      { name: "planner", binding: null, params: {}, fallback: [] },
      { name: "executor", binding: null, params: {}, fallback: [] },
    ],
  };
  const conv: Conversation = {
    id: "c1",
    title: "t",
    createdAt: "x",
    updatedAt: "x",
    messages: [],
    mode: "single",
    plannerTag: "planner",
    executorTag: "executor",
  };
  const convs = new Map([[conv.id, conv]]);
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
    saveSettings: (n) => Object.assign(settings, n),
  };
  const engine: EngineLike = {
    status: () => ({ status: "ready", name: "e.gguf" }),
    loadModel: async (p: string) => ({ status: "ready", name: p }),
    unloadModel: () => {},
    isGenerating: () => false,
    contextSize: () => 4096,
    chatTemplate: () => null,
    tokenCount: (t: string) => t.length,
    generate: async () => ({ status: "complete", tokens: 0, elapsedMs: 1, warm: false }),
    stop: () => {},
  };
  const deps = {
    engine,
    store,
    roles: new RolesService({ store, scan: () => [] }),
    emit: (m: string, p: unknown) => emitted.push({ method: m, payload: p }),
  } as never;
  const call = (method: string, params: Record<string, unknown>) =>
    (createRequestHandlers(deps) as never)[method](params);
  return { call, conv, emitted };
}

describe("conversation.setMode", () => {
  test("fusion refused with ROLE_UNBOUND naming the missing role", () => {
    const { call } = makeDeps();
    expect(() =>
      call("conversation.setMode", { conversationId: "c1", mode: "fusion" }),
    ).toThrow(/planner role "planner"/);
  });

  test("fusion accepted when both roles bound; fields persist", () => {
    const { call, conv } = makeDeps();
    call("role.bind", { name: "planner", fileName: "p.gguf" });
    call("role.bind", { name: "executor", fileName: "e.gguf" });
    call("conversation.setMode", { conversationId: "c1", mode: "fusion" });
    expect(conv.mode).toBe("fusion");
    expect(conv.plannerTag).toBe("planner");
    call("conversation.setMode", {
      conversationId: "c1",
      mode: "fusion",
      plannerTag: "executor",
    });
    expect(conv.plannerTag).toBe("executor");
  });

  test("unknown conversation -> NOT_FOUND; single mode skips validation", () => {
    const { call } = makeDeps();
    expect(() =>
      call("conversation.setMode", { conversationId: "ghost", mode: "fusion" }),
    ).toThrow();
    // single mode needs no bindings
    call("conversation.setMode", { conversationId: "c1", mode: "single" });
  });
});

// T019: single-mode runtime cascade — primary slot fails at load, the
// fallback candidate serves and servedBy surfaces via chat.phase +
// persisted message.phases.answer.
describe("single-mode fallback cascade (T019)", () => {
  test("primary load failure -> fallback serves + notice emitted", async () => {
    const emitted: { method: string; payload: unknown }[] = [];
    const settings: Settings = {
      activeModelPath: null,
      contextLimitWarning: false,
      generation: DEFAULT_GENERATION,
      modelOverrides: {},
      tags: [
        {
          name: "default",
          binding: "bad.gguf",
          params: {},
          fallback: [{ kind: "model", fileName: "e.gguf" }],
        },
      ],
    };
    writeFileSync(join(dir, "bad.gguf"), "x");
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
      getSettings: () => settings,
      saveSettings: (n) => Object.assign(settings, n),
    };
    let i = 0;
    const fake = (ok: boolean): SlotEngine =>
      ({
        status: () => ({ status: "ready" as const, name: "f" }),
        loadModel: async () => {
          if (!ok) throw new Error("corrupt gguf");
          return { status: "ready" as const, name: "f" };
        },
        unloadModel: () => {},
        isGenerating: () => false,
        contextSize: () => 4096,
        chatTemplate: () => null,
        tokenCount: (t: string) => Math.ceil(t.length / 4),
        stop: () => {},
        dispose: () => {},
        generate: async (_p: string, onToken: (d: string) => void) => {
          onToken("HI");
          return { status: "complete" as const, tokens: 1, elapsedMs: 1, warm: false };
        },
      }) as unknown as SlotEngine;
    // first acquired engine (primary) fails to load; second (fallback) serves
    const registry = new ModelRegistry(2, () => fake(i++ !== 0));
    const engine: EngineLike = {
      status: () => ({ status: "ready", name: "e.gguf" }),
      loadModel: async (p: string) => ({ status: "ready", name: p }),
      unloadModel: () => {},
      isGenerating: () => false,
      contextSize: () => 4096,
      chatTemplate: () => null,
      tokenCount: (t: string) => t.length,
      generate: async () => ({ status: "complete", tokens: 0, elapsedMs: 1, warm: false }),
      stop: () => {},
    };
    const deps = {
      engine,
      store,
      registry,
      roles: new RolesService({ store, scan: () => [] }),
      emit: (m: string, p: unknown) => emitted.push({ method: m, payload: p }),
    } as never;
    const call = (method: string, params: Record<string, unknown>) =>
      (createRequestHandlers(deps) as never)[method](params);

    const { messageId } = call("chat.send", {
      conversationId: "c2",
      content: "hi",
    }) as { messageId: string };
    // generation runs async; wait for chat.done
    await new Promise<void>((resolve) => {
      const t = setInterval(() => {
        if (emitted.some((e) => e.method === "chat.done" || e.method === "chat.error")) {
          clearInterval(t);
          resolve();
        }
      }, 5);
    });
    const phase = emitted.find((e) => e.method === "chat.phase");
    expect(phase).toBeDefined();
    expect((phase!.payload as { servedBy: string }).servedBy).toBe("fallback");
    const conv = convs.get("c2")!;
    const msg = conv.messages.find((m) => m.id === messageId)!;
    expect(msg.content).toBe("HI");
    expect(msg.status).toBe("complete");
    expect(msg.phases?.answer?.servedBy).toBe("fallback");
    expect(msg.phases?.answer?.fileName).toBe("e.gguf");
  });
});
