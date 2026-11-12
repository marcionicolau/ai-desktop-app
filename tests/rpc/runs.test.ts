// feature 017 (T034): run.* over RPC — start/cancel/list/get/clear,
// bidirectional ENGINE_BUSY serialization with chat (I2), step events.
import { beforeEach, describe, expect, test } from "bun:test";
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

const FX = join(import.meta.dir, "../extensions/fixtures");
let data: string;

const convs = new Map<string, Conversation>();
const settings: Settings = {
  activeModelPath: null,
  contextLimitWarning: false,
  generation: DEFAULT_GENERATION,
  modelOverrides: {},
};
const store: StoreLike = {
  getConversation: (id) => convs.get(id) ?? null,
  saveConversation: (c) => void convs.set(c.id, c),
  listConversations: () => [...convs.values()].map((c) => ({
    id: c.id, title: c.title, updatedAt: c.updatedAt,
  })),
  deleteConversation: (id) => convs.delete(id),
  getSettings: () => settings,
  saveSettings: (n) => Object.assign(settings, n),
};

const fakeEngine = (gen: EngineLike["generate"]): EngineLike => ({
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

const okGen: EngineLike["generate"] = async (_p, onToken) => {
  onToken?.('{"summary":"s","actions":"a"}');
  return { status: "complete" as const, tokens: 2, elapsedMs: 1, warm: true, promptTokens: 4 };
};

const make = (engine = fakeEngine(okGen)) => {
  const emitted: { method: string; payload: unknown }[] = [];
  const deps = {
    engine,
    store,
    roles: new RolesService({ store, scan: () => [] }),
    emit: (m: string, p: unknown) => emitted.push({ method: m, payload: p }),
  } as never;
  const handlers = createRequestHandlers(deps) as never;
  const call = async (method: string, params: Record<string, unknown> = {}) =>
    handlers[method](params);
  return { call, emitted };
};

const enableNotes = async (call: (m: string, p?: Record<string, unknown>) => Promise<never>) => {
  const { pack } = await call("extension.install", {
    source: { kind: "folder", path: join(FX, "notes-pack") },
  });
  await call("extension.enable", { packId: pack.id, consent: true });
};

const waitStatus = async (call: (m: string, p?: Record<string, unknown>) => Promise<never>, runId: string, want: string[]) => {
  for (let i = 0; i < 400; i++) {
    const { run } = await call("run.get", { runId });
    if (run && want.includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`run never reached ${want.join("|")}`);
};

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), "rpc-run-"));
  process.env.APP_DATA_DIR = data;
  process.env.MODELS_DIR = data;
  writeFileSync(join(data, "e.gguf"), "x");
});

describe("run.* rpc", () => {
  test("start → events/status emitted → completed → list/get/clear", async () => {
    const { call, emitted } = make();
    await enableNotes(call);
    const { runId } = await call("run.start", {
      packId: "notes-pack",
      target: { kind: "pipeline", id: "document-summary" },
      objective: "digest",
      params: { transcript: "a long meeting transcript with many words spoken" },
    });
    const rec = await waitStatus(call, runId, ["completed", "failed"]);
    expect(rec.status).toBe("completed");
    expect(emitted.some((e) => e.method === "run.event")).toBe(true);
    expect(emitted.some((e) => e.method === "run.status")).toBe(true);
    const { runs } = await call("run.list", { packId: "notes-pack" });
    expect(runs.some((r: { id: string }) => r.id === runId)).toBe(true);
    const { removed } = await call("run.clear", { packId: "notes-pack" });
    expect(removed).toBeGreaterThan(0);
  });

  test("run.start on disabled/unknown → errors; empty objective → INVALID_PARAMS", async () => {
    const { call } = make();
    await expect(
      call("run.start", { packId: "nope", target: { kind: "pipeline", id: "x" }, objective: "o" }),
    ).rejects.toThrowError(/no pack/);
    await enableNotes(call);
    await expect(
      call("run.start", { packId: "notes-pack", target: { kind: "pipeline", id: "x" }, objective: "" }),
    ).rejects.toThrowError(/INVALID_PARAMS|objective/);
    await expect(
      call("run.start", { packId: "notes-pack", target: { kind: "pipeline", id: "ghost" }, objective: "o" }),
    ).rejects.toThrowError(/no pipeline|CONTRIBUTION_NOT_FOUND/);
  });

  test("chat.send while a fabric run is active → ENGINE_BUSY (I2)", async () => {
    let release: (() => void) | null = null;
    const blocking = fakeEngine((_p, onToken) =>
      new Promise((res) => {
        release = () => {
          onToken?.('{"summary":"s"}');
          res({ status: "complete", tokens: 1, elapsedMs: 1, warm: true });
        };
      }),
    );
    const { call } = make(blocking);
    await enableNotes(call);
    convs.set("c1", {
      id: "c1", title: "t", createdAt: "x", updatedAt: "x",
      messages: [], mode: "single", plannerTag: "planner", executorTag: "executor",
    });
    await call("run.start", {
      packId: "notes-pack",
      target: { kind: "pipeline", id: "document-summary" },
      objective: "o",
      params: { transcript: "a long meeting transcript with many words spoken" },
    });
    await new Promise((r) => setTimeout(r, 20));
    await expect(
      call("chat.send", { conversationId: "c1", content: "hi" }),
    ).rejects.toThrowError(/in progress|busy|ENGINE_BUSY/i);
    release?.();
  });
});
