// feature 016 RPC contract: metrics.list/clear roundtrip, the
// settings.outputPanel gate, single-mode + fusion + fallback entries,
// and the live metrics.entry event.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MetricsStore } from "../../src/bun/metrics/store";
import { RolesService } from "../../src/bun/models/roles";
import { ModelRegistry, type SlotEngine } from "../../src/bun/models/registry";
import {
  createRequestHandlers,
  type EngineLike,
  type StoreLike,
} from "../../src/bun/rpc/handlers";
import type {
  Conversation,
  MetricEntry,
  Settings,
} from "../../src/shared/types";
import { DEFAULT_GENERATION } from "../../src/shared/types";

const dir = mkdtempSync(join(tmpdir(), "metrics-rpc-"));
process.env.MODELS_DIR = dir;
writeFileSync(join(dir, "e.gguf"), "x");

function makeStore(outputPanel: boolean, convs: Map<string, Conversation>) {
  const settings: Settings = {
    activeModelPath: null,
    contextLimitWarning: false,
    generation: DEFAULT_GENERATION,
    modelOverrides: {},
    outputPanel,
    tags: [
      { name: "default", binding: "e.gguf", params: {}, fallback: [] },
      { name: "planner", binding: "e.gguf", params: {}, fallback: [] },
      { name: "executor", binding: "e.gguf", params: {}, fallback: [] },
    ],
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
    getSettings: () => settings,
    saveSettings: (n) => Object.assign(settings, n),
  };
  return { store, settings };
}

const fakeEngine = (
  gen: EngineLike["generate"] = async (_p, onToken) => {
    onToken?.("HI");
    return {
      status: "complete" as const,
      tokens: 1,
      elapsedMs: 5,
      warm: true,
      promptTokens: 7,
    };
  },
): EngineLike => ({
  status: () => ({ status: "ready", name: "e.gguf" }),
  loadModel: async (p: string) => ({ status: "ready", name: p }),
  unloadModel: () => {},
  isGenerating: () => false,
  contextSize: () => 4096,
  chatTemplate: () => null,
  tokenCount: (t: string) => t.length,
  generate: gen,
  stop: () => {},
});

function makeDeps(outputPanel: boolean, engine = fakeEngine()) {
  const emitted: { method: string; payload: unknown }[] = [];
  const convs = new Map<string, Conversation>([
    [
      "c1",
      {
        id: "c1",
        title: "t",
        createdAt: "x",
        updatedAt: "x",
        messages: [],
        mode: "single",
        plannerTag: "planner",
        executorTag: "executor",
      },
    ],
  ]);
  const { store, settings } = makeStore(outputPanel, convs);
  const metrics = new MetricsStore();
  const deps = {
    engine,
    store,
    metrics,
    roles: new RolesService({ store, scan: () => [] }),
    emit: (m: string, p: unknown) => emitted.push({ method: m, payload: p }),
  } as never;
  const call = (method: string, params: Record<string, unknown>) =>
    (createRequestHandlers(deps) as never)[method](params);
  return { call, emitted, metrics, settings };
}

const waitDone = async (emitted: { method: string }[]) => {
  for (let i = 0; i < 200; i++) {
    if (
      emitted.some(
        (e) => e.method === "chat.done" || e.method === "chat.error",
      )
    ) {
      return;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("chat.done never arrived");
};

describe("metrics rpc", () => {
  test("settings.get/set roundtrips outputPanel; default off", async () => {
    const { call, settings } = makeDeps(false);
    const s = await call("settings.get", {});
    expect(s.outputPanel).toBe(false);
    await call("settings.set", { outputPanel: true });
    expect(settings.outputPanel).toBe(true);
    expect((await call("settings.get", {})).outputPanel).toBe(true);
  });

  test("toggle off records nothing; toggle on records one entry", async () => {
    const { call, metrics, emitted } = makeDeps(false);
    call("chat.send", { conversationId: "c1", content: "hi" });
    await waitDone(emitted);
    expect(metrics.list()).toHaveLength(0);

    await call("settings.set", { outputPanel: true });
    call("chat.send", { conversationId: "c1", content: "hi again" });
    await waitDone(emitted);
    const entries = metrics.list();
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.modelFile).toBe("e.gguf");
    expect(e.roleKey).toBe("main");
    expect(e.promptTokens).toBe(7);
    expect(e.outputTokens).toBe(1);
    expect(e.warm).toBe(true);
    expect(e.status).toBe("complete");
    expect(e.promptPreview.length).toBeLessThanOrEqual(120);
  });

  test("metrics.entry event fires live; list/clear roundtrip", async () => {
    const { call, emitted } = makeDeps(true);
    call("chat.send", { conversationId: "c1", content: "hi" });
    await waitDone(emitted);
    const ev = emitted.find((e) => e.method === "metrics.entry");
    expect(ev).toBeDefined();
    const entry = (ev!.payload as MetricEntry);
    expect((await call("metrics.list", {})).entries).toHaveLength(1);
    const r = await call("metrics.clear", {});
    expect(r.removed).toBe(1);
    expect((await call("metrics.list", {})).entries).toHaveLength(0);
    expect(entry.status).toBe("complete");
  });

  test("a throwing generate records a failed entry", async () => {
    const { call, metrics } = makeDeps(
      true,
      fakeEngine(async () => {
        throw new Error("boom");
      }),
    );
    call("chat.send", { conversationId: "c1", content: "hi" });
    // wait for the terminal event
    for (let i = 0; i < 200; i++) {
      if (metrics.list().length > 0) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(metrics.list()).toHaveLength(1);
    expect(metrics.list()[0].status).toBe("failed");
  });

  test("fusion emits one entry per phase with correct roles", async () => {
    const emitted: { method: string; payload: unknown }[] = [];
    const convs = new Map<string, Conversation>([
      [
        "c2",
        {
          id: "c2",
          title: "t",
          createdAt: "x",
          updatedAt: "x",
          messages: [],
          mode: "fusion",
          plannerTag: "planner",
          executorTag: "executor",
        },
      ],
    ]);
    const { store, settings } = makeStore(true, convs);
    const metrics = new MetricsStore();
    const slot: SlotEngine = {
      ...fakeEngine(async (_p, onToken) => {
        onToken?.("OK");
        return {
          status: "complete" as const,
          tokens: 2,
          elapsedMs: 3,
          warm: false,
          promptTokens: 11,
        };
      }),
      dispose: () => {},
    };
    const registry = new ModelRegistry(2, () => slot);
    const deps = {
      engine: fakeEngine(),
      store,
      metrics,
      registry,
      roles: new RolesService({ store, scan: () => [] }),
      emit: (m: string, p: unknown) =>
        emitted.push({ method: m, payload: p }),
    } as never;
    const call = (method: string, params: Record<string, unknown>) =>
      (createRequestHandlers(deps) as never)[method](params);
    call("chat.send", { conversationId: "c2", content: "hi" });
    await waitDone(emitted);
    const entries = metrics.list();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.roleKey)).toEqual(["planner", "executor"]);
    expect(entries.every((e) => e.modelFile === "e.gguf")).toBe(true);
    expect(entries.every((e) => e.promptTokens === 11)).toBe(true);
  });
});
