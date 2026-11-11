// feature 015 RPC tests: pending → respond → execute; deny; stop while
// pending; busy gate; refusal; settings policy; deny-mode invariance.
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EngineError } from "../../src/bun/llama/engine";
import {
  createRequestHandlers,
  type EngineLike,
  type HandlerDeps,
  type StoreLike,
} from "../../src/bun/rpc/handlers";
import { ToolService } from "../../src/bun/tools/service";
import { RolesService } from "../../src/bun/models/roles";
import { ModelRegistry, type SlotEngine } from "../../src/bun/models/registry";
import type { Conversation, Settings } from "../../src/shared/types";
import { DEFAULT_GENERATION } from "../../src/shared/types";

const dir = join(
  tmpdir(),
  `tools-rpc-${process.pid}-${Date.now().toString(36)}`,
);
beforeAll(() => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "a.txt"), "ALBATROSS");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const CALL_A = '```tool_call\n{"tool":"read_file","path":"a.txt"}\n```';
const CALL_OUT = '```tool_call\n{"tool":"read_file","path":"../x"}\n```';

function makeDeps(opts: {
  segments?: string[];
  tools?: Settings["tools"];
  pickRoot?: string | null;
}) {
  const emitted: { method: string; payload: unknown }[] = [];
  const convs = new Map<string, Conversation>();
  let generating = false;
  let stopped = false;
  const prompts: string[] = [];
  const settings: Settings = {
    activeModelPath: null,
    contextLimitWarning: false,
    generation: DEFAULT_GENERATION,
    modelOverrides: {},
    tags: [],
    tools: opts.tools,
  } as Settings;

  const engine: EngineLike = {
    status: () => ({ status: "ready", name: "fake.gguf" }),
    loadModel: async () => ({ status: "ready" as const, name: "fake.gguf" }),
    unloadModel: () => {},
    isGenerating: () => generating,
    contextSize: () => 4096,
    chatTemplate: () => null,
    tokenCount: (t: string) => Math.ceil(t.length / 4),
    stop: () => {
      stopped = true;
    },
    generate: async (prompt, onToken) => {
      prompts.push(prompt);
      stopped = false;
      generating = true;
      const seg = opts.segments?.shift() ?? "ok";
      let tokens = 0;
      for (const ch of seg) {
        if (stopped) {
          generating = false;
          return { status: "partial", tokens, elapsedMs: 1, warm: false };
        }
        tokens += 1;
        onToken(ch);
        await new Promise((r) => setTimeout(r, 0));
      }
      generating = false;
      return { status: "complete", tokens, elapsedMs: 1, warm: false };
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
    getSettings: () => settings,
    saveSettings: (s) => Object.assign(settings, s),
  };

  const deps: HandlerDeps = {
    engine,
    store,
    emit: (method, payload) => emitted.push({ method, payload }),
    tools: new ToolService({ getSettings: () => settings }),
    dialogs: { pickFolder: async () => opts.pickRoot ?? null },
  };
  return { deps, emitted, convs, engine, prompts, settings };
}

const CONV = "conv-1";
const flush = () => new Promise((r) => setTimeout(r, 10));
const waitFor = async (
  pred: () => boolean,
  what: string,
  ms = 5000,
): Promise<void> => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};
const of = (
  emitted: { method: string; payload: unknown }[],
  m: string,
) => emitted.filter((e) => e.method === m);

const ask = (): Settings["tools"] => ({ sandboxRoot: dir, mode: "ask" });

describe("tool call turn", () => {
  test("pending → approve → executed, result streamed", async () => {
    const { deps, emitted, convs } = makeDeps({
      tools: ask(),
      segments: [CALL_A, "\nanswer uses ALBATROSS"],
    });
    const h = createRequestHandlers(deps);
    h["chat.send"]({ conversationId: CONV, content: "read it" });
    await waitFor(() => of(emitted, "tool.update").length > 0, "pending tool.update");

    const pending = of(emitted, "tool.update").filter(
      (e) => (e.payload as { call: { status: string } }).call.status === "pending",
    );
    expect(pending).toHaveLength(1);
    const callId = (
      pending[0].payload as { call: { id: string } }
    ).call.id;
    h["tool.respond"]({ callId, decision: "approve" });
    await waitFor(() => of(emitted, "chat.done").length > 0, "chat.done");

    const conv = convs.get(CONV)!;
    const msg = conv.messages.at(-1)!;
    expect(msg.status).toBe("complete");
    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.toolCalls![0].status).toBe("executed");
    expect(msg.toolCalls![0].resolvedPath).toBe(join(dir, "a.txt"));
    expect(msg.content).toContain("ALBATROSS"); // result + answer
    expect(of(emitted, "chat.done")).toHaveLength(1);
  });

  test("deny → denied record, turn completes", async () => {
    const { deps, emitted, convs } = makeDeps({
      tools: ask(),
      segments: [CALL_A, " fine"],
    });
    const h = createRequestHandlers(deps);
    h["chat.send"]({ conversationId: CONV, content: "read it" });
    await waitFor(() => of(emitted, "tool.update").length > 0, "pending");
    const callId = (
      of(emitted, "tool.update")[0].payload as { call: { id: string } }
    ).call.id;
    h["tool.respond"]({ callId, decision: "deny" });
    await waitFor(() => of(emitted, "chat.done").length > 0, "chat.done");
    const msg = convs.get(CONV)!.messages.at(-1)!;
    expect(msg.status).toBe("complete");
    expect(msg.toolCalls![0].status).toBe("denied");
  });

  test("stop while pending → partial, call denied(stopped)", async () => {
    const { deps, emitted, convs } = makeDeps({
      tools: ask(),
      segments: [CALL_A, " never"],
    });
    const h = createRequestHandlers(deps);
    const { messageId } = h["chat.send"]({
      conversationId: CONV,
      content: "read it",
    });
    await waitFor(() => of(emitted, "tool.update").length > 0, "pending");
    h["chat.stop"]({ messageId });
    await waitFor(() => of(emitted, "chat.done").length > 0, "chat.done");
    const msg = convs.get(CONV)!.messages.at(-1)!;
    expect(msg.status).toBe("partial");
    expect(msg.toolCalls![0].status).toBe("denied");
    expect(msg.toolCalls![0].error).toBe("stopped");
  });

  test("second send during approval pause → ENGINE_BUSY", async () => {
    const { deps, emitted } = makeDeps({
      tools: ask(),
      segments: [CALL_A, " done"],
    });
    const h = createRequestHandlers(deps);
    h["chat.send"]({ conversationId: CONV, content: "read it" });
    await waitFor(() => of(emitted, "tool.update").length > 0, "pending");
    try {
      h["chat.send"]({ conversationId: "conv-2", content: "another" });
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("ENGINE_BUSY");
    }
    // clean up: approve so the turn can finish
    const callId = (
      of(emitted, "tool.update")[0].payload as { call: { id: string } }
    ).call.id;
    h["tool.respond"]({ callId, decision: "approve" });
    await waitFor(() => of(emitted, "chat.done").length > 0, "chat.done");
  });

  test("out-of-sandbox refuses without a pending emit", async () => {
    const { deps, emitted, convs } = makeDeps({
      tools: ask(),
      segments: [CALL_OUT, " sorry"],
    });
    const h = createRequestHandlers(deps);
    h["chat.send"]({ conversationId: CONV, content: "read it" });
    await waitFor(() => of(emitted, "chat.done").length > 0, "chat.done");
    const updates = of(emitted, "tool.update").map(
      (e) => (e.payload as { call: { status: string } }).call.status,
    );
    expect(updates).not.toContain("pending");
    const msg = convs.get(CONV)!.messages.at(-1)!;
    expect(msg.toolCalls![0].status).toBe("refused");
    expect(msg.toolCalls![0].refuseReason).toBe("out-of-sandbox");
  });

  test("tool.respond on unknown call → NOT_FOUND", () => {
    const { deps } = makeDeps({});
    const h = createRequestHandlers(deps);
    try {
      h["tool.respond"]({ callId: "nope", decision: "approve" });
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("NOT_FOUND");
    }
  });
});

describe("tool policy", () => {
  test("settings roundtrip + validation", async () => {
    const { deps } = makeDeps({ pickRoot: dir });
    const h = createRequestHandlers(deps);
    expect(h["settings.get"]({}).tools).toEqual({
      sandboxRoot: null,
      mode: "deny",
    });
    const picked = await h["tool.pickRoot"]({});
    expect(picked.path).toBe(dir);
    h["settings.set"]({
      tools: { sandboxRoot: picked.path, mode: "ask" },
    });
    expect(h["settings.get"]({}).tools.mode).toBe("ask");
    try {
      h["settings.set"]({ tools: { sandboxRoot: "/no/such/dir" } });
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("INVALID_PARAMS");
    }
  });

  test("deny mode: no instruction injected; stray block refused", async () => {
    const { deps, emitted, convs, prompts } = makeDeps({
      tools: { sandboxRoot: dir, mode: "deny" },
      segments: [CALL_A, "done"],
    });
    const h = createRequestHandlers(deps);
    h["chat.send"]({ conversationId: CONV, content: "read it" });
    await waitFor(() => of(emitted, "chat.done").length > 0, "chat.done");
    expect(prompts[0]).not.toContain("tool_call");
    const msg = convs.get(CONV)!.messages.at(-1)!;
    expect(msg.toolCalls![0].status).toBe("refused");
    expect(msg.toolCalls![0].refuseReason).toBe("disabled");
    expect(
      of(emitted, "tool.update").some(
        (e) => (e.payload as { call: { status: string } }).call.status === "pending",
      ),
    ).toBe(false);
  });

  test("deny mode: prompt is byte-identical to tools-unset (T021)", async () => {
    const a = makeDeps({
      tools: { sandboxRoot: dir, mode: "deny" },
      segments: ["ok"],
    });
    const b = makeDeps({ segments: ["ok"] }); // tools unset entirely
    const ha = createRequestHandlers(a.deps);
    const hb = createRequestHandlers(b.deps);
    ha["chat.send"]({ conversationId: CONV, content: "same input" });
    hb["chat.send"]({ conversationId: CONV, content: "same input" });
    await waitFor(() => of(a.emitted, "chat.done").length > 0, "a done");
    await waitFor(() => of(b.emitted, "chat.done").length > 0, "b done");
    expect(a.prompts[0]).toBe(b.prompts[0]);
  });

  test("ask mode: instruction IS injected", async () => {
    const { deps, emitted, prompts } = makeDeps({
      tools: ask(),
      segments: ["ok"],
    });
    const h = createRequestHandlers(deps);
    h["chat.send"]({ conversationId: CONV, content: "hi" });
    await waitFor(() => of(emitted, "chat.done").length > 0, "chat.done");
    expect(prompts[0]).toContain("tool_call");
    expect(prompts[0]).toContain("read_file");
  });

  test("allowSession grant auto-approves later calls in that conversation", async () => {
    const svcDeps = makeDeps({
      tools: ask(),
      segments: [CALL_A, "one", CALL_A, "two"],
    });
    const h = createRequestHandlers(svcDeps.deps);
    h["chat.send"]({ conversationId: CONV, content: "read" });
    await waitFor(() => of(svcDeps.emitted, "tool.update").length > 0, "pending");
    const callId = (
      of(svcDeps.emitted, "tool.update")[0].payload as {
        call: { id: string };
      }
    ).call.id;
    h["tool.respond"]({ callId, decision: "allowSession" });
    await waitFor(() => of(svcDeps.emitted, "chat.done").length > 0, "chat.done");

    // second turn in the same conversation: executes without pending
    svcDeps.emitted.length = 0;
    h["chat.send"]({ conversationId: CONV, content: "again" });
    await waitFor(() => of(svcDeps.emitted, "chat.done").length > 0, "chat.done");
    const updates = of(svcDeps.emitted, "tool.update").map(
      (e) => (e.payload as { call: { status: string } }).call.status,
    );
    expect(updates).not.toContain("pending");
    const msg = svcDeps.convs.get(CONV)!.messages.at(-1)!;
    expect(msg.toolCalls![0].status).toBe("executed");
  });

  test("session grant does not leak to another conversation (T022)", async () => {
    const d = makeDeps({
      tools: ask(),
      segments: [CALL_A, "one", CALL_A, "two"],
    });
    const h = createRequestHandlers(d.deps);
    h["chat.send"]({ conversationId: CONV, content: "read" });
    await waitFor(() => of(d.emitted, "tool.update").length > 0, "pending");
    const callId = (
      of(d.emitted, "tool.update")[0].payload as { call: { id: string } }
    ).call.id;
    h["tool.respond"]({ callId, decision: "allowSession" });
    await waitFor(() => of(d.emitted, "chat.done").length > 0, "done");

    // different conversation: the grant is per-conversation — prompts again
    d.emitted.length = 0;
    h["chat.send"]({ conversationId: "conv-2", content: "read" });
    await waitFor(() => of(d.emitted, "tool.update").length > 0, "pending");
    const updates = of(d.emitted, "tool.update").map(
      (e) => (e.payload as { call: { status: string } }).call.status,
    );
    expect(updates).toContain("pending");
    // clean up the pending turn
    const cid = (
      of(d.emitted, "tool.update")[0].payload as { call: { id: string } }
    ).call.id;
    h["tool.respond"]({ callId: cid, decision: "deny" });
    await waitFor(() => of(d.emitted, "chat.done").length > 0, "done");
  });
});

// feature 015 (FR-009): only the executor's answer phase is scanned —
// the planner's fenced blocks stay inert text in the plan card.
describe("fusion executor-only tools (T023)", () => {
  test("planner block is inert; executor block pauses for approval", async () => {
    const emitted: { method: string; payload: unknown }[] = [];
    const convs = new Map<string, Conversation>();
    const conv: Conversation = {
      id: CONV,
      title: "t",
      createdAt: "x",
      updatedAt: "x",
      messages: [],
      mode: "fusion",
      plannerTag: "planner",
      executorTag: "executor",
    } as Conversation;
    convs.set(CONV, conv);
    const settings = {
      activeModelPath: null,
      contextLimitWarning: false,
      generation: DEFAULT_GENERATION,
      modelOverrides: {},
      tags: [
        { name: "default", binding: "e.gguf", params: {}, fallback: [] },
        { name: "planner", binding: "p.gguf", params: {}, fallback: [] },
        { name: "executor", binding: "e.gguf", params: {}, fallback: [] },
      ],
      tools: { sandboxRoot: dir, mode: "ask" },
    } as Settings;
    const store: StoreLike = {
      getConversation: (id) => convs.get(id) ?? null,
      saveConversation: (c) => void convs.set(c.id, c),
      listConversations: () =>
        [...convs.values()].map((c) => ({
          id: c.id,
          title: c.title,
          updatedAt: c.updatedAt,
        })),
      deleteConversation: () => true,
      getSettings: () => settings,
      saveSettings: (s) => Object.assign(settings, s),
    };

    const execSegs = [CALL_A, " done"];
    let execCalls = 0;
    const fake = (segments: string[], onGen?: () => void): SlotEngine => {
      let stopped = false;
      return {
        status: () => ({ status: "ready" as const, name: "f" }),
        loadModel: async () => ({ status: "ready" as const, name: "f" }),
        unloadModel: () => {},
        isGenerating: () => false,
        contextSize: () => 4096,
        chatTemplate: () => null,
        tokenCount: (t: string) => Math.ceil(t.length / 4),
        stop: () => {
          stopped = true;
        },
        dispose: () => {},
        generate: async (_p: string, onToken: (d: string) => void) => {
          onGen?.();
          stopped = false;
          const seg = segments.shift() ?? "ok";
          for (const ch of seg) {
            if (stopped)
              return {
                status: "partial" as const,
                tokens: 1,
                elapsedMs: 1,
                warm: false,
              };
            onToken(ch);
          }
          return {
            status: "complete" as const,
            tokens: 1,
            elapsedMs: 1,
            warm: false,
          };
        },
      } as unknown as SlotEngine;
    };
    // planner emits a tool_call in its plan; executor emits one mid-answer
    const planner = fake([`plan ${CALL_A} steps`]);
    const executor = fake(execSegs, () => execCalls++);
    let i = 0;
    const registry = new ModelRegistry(2, () => (i++ === 0 ? planner : executor));
    // role bindings resolve via MODELS_DIR — the factory fakes the slots
    process.env.MODELS_DIR = dir;
    writeFileSync(join(dir, "p.gguf"), "x");
    writeFileSync(join(dir, "e.gguf"), "x");

    const deps = {
      engine: executor as unknown as EngineLike,
      store,
      registry,
      roles: new RolesService({ store, scan: () => [] }),
      tools: new ToolService({ getSettings: () => settings }),
      emit: (m: string, p: unknown) => emitted.push({ method: m, payload: p }),
    } as never;
    const call = (method: string, params: Record<string, unknown>) =>
      (createRequestHandlers(deps) as never)[method](params);

    call("chat.send", { conversationId: CONV, content: "do it" });
    // the only pending emit is the executor's call — plan text is inert
    await waitFor(() => of(emitted, "tool.update").length > 0, "pending");
    const updates = of(emitted, "tool.update");
    expect(updates).toHaveLength(1);
    const callId = (updates[0].payload as { call: { id: string } }).call.id;
    call("tool.respond", { callId, decision: "approve" });
    await waitFor(() => of(emitted, "chat.done").length > 0, "done");

    const msg = convs.get(CONV)!.messages.at(-1)!;
    expect(msg.status).toBe("complete");
    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.toolCalls![0].status).toBe("executed");
    // plan kept its raw block as prose — never became a call record
    expect(msg.phases?.plan?.content).toContain("tool_call");
    expect(execCalls).toBeGreaterThanOrEqual(2); // generate + continuation
  });
});
