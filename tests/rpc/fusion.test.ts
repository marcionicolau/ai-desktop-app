// conversation.setMode contract (T016): fusion gating names the missing
// role; mode/tags persist on the conversation.
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
