// feature 006 RPC tests: conversation.setPersona, system prompt injection,
// param precedence (persona over global, under model override), deletion
// clearing assignments, per-conversation isolation (T009/T012).
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
import { PersonaService } from "../../src/bun/personas/service";

function makeDeps(overrides?: {
  generation?: Partial<typeof DEFAULT_GENERATION>;
  modelOverrides?: Settings["modelOverrides"];
}) {
  const convs = new Map<string, Conversation>();
  const settings = {
    activeModelPath: "m.gguf",
    contextLimitWarning: false,
    generation: { ...DEFAULT_GENERATION, ...overrides?.generation },
    modelOverrides: overrides?.modelOverrides ?? {},
    tags: [],
  } as Settings;
  const prompts: string[] = [];
  const paramsSeen: (typeof DEFAULT_GENERATION | null | undefined)[] = [];
  const engine: EngineLike = {
    status: () => ({ status: "ready" as const, name: "m.gguf" }),
    loadModel: async () => ({ status: "ready" as const, name: "m.gguf" }),
    unloadModel: () => {},
    isGenerating: () => false,
    contextSize: () => 4096,
    chatTemplate: () => null,
    tokenCount: (t) => Math.ceil(t.length / 4),
    generate: async (prompt, onToken, params) => {
      prompts.push(prompt);
      paramsSeen.push(params);
      onToken("ok");
      return {
        status: "complete" as const,
        tokens: 1,
        elapsedMs: 1,
        warm: false,
      };
    },
    stop: () => {},
  };
  const store: StoreLike = {
    getConversation: (id) => convs.get(id) ?? null,
    saveConversation: (c) => void convs.set(c.id, { ...c }),
    listConversations: () =>
      [...convs.values()]
        .map((c) => ({
          id: c.id,
          title: c.title,
          updatedAt: c.updatedAt,
          personaName: c.personaName ?? null,
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    deleteConversation: (id) => convs.delete(id),
    getSettings: () => settings,
    saveSettings: (s) => Object.assign(settings, s),
  };
  const deps: HandlerDeps = {
    engine,
    store,
    emit: () => {},
    personas: new PersonaService({
      store,
      tagNames: () => ["default", "coder"],
      getConversation: (id) => convs.get(id) ?? null,
      saveConversation: (c) => void convs.set(c.id, { ...c }),
    }),
  };
  return { deps, convs, prompts, paramsSeen, settings };
}

// wait for the async generation run to settle
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("persona/snippet RPC + prompt injection", () => {
  test("setPersona assigns/unassigns and returns suggestedTag", () => {
    const { deps } = makeDeps();
    const h = createRequestHandlers(deps);
    const c = h["conversation.create"]({});
    h["persona.upsert"]({
      persona: {
        name: "steery",
        systemPrompt: "Steer.",
        params: null,
        preferredTag: "default",
      },
    });
    const r = h["conversation.setPersona"]({
      conversationId: c.id,
      personaName: "steery",
    });
    expect(r).toEqual({ suggestedTag: "default" });
    expect(
      h["conversation.get"]({ conversationId: c.id }).personaName,
    ).toBe("steery");
    expect(
      h["conversation.setPersona"]({ conversationId: c.id, personaName: null }),
    ).toEqual({});
    expect(
      h["conversation.get"]({ conversationId: c.id }).personaName,
    ).toBeNull();
  });

  test("setPersona unknown conv/persona -> NOT_FOUND", () => {
    const { deps } = makeDeps();
    const h = createRequestHandlers(deps);
    const c = h["conversation.create"]({});
    for (const call of [
      () =>
        h["conversation.setPersona"]({
          conversationId: "nope",
          personaName: "tutor",
        }),
      () =>
        h["conversation.setPersona"]({
          conversationId: c.id,
          personaName: "nope",
        }),
    ]) {
      try {
        call();
        expect.unreachable();
      } catch (e) {
        expect((e as EngineError).code).toBe("NOT_FOUND");
      }
    }
  });

  test("system prompt injected into generate; persona params beat global", async () => {
    const { deps, prompts, paramsSeen } = makeDeps({
      generation: { temperature: 0.5 },
    });
    const h = createRequestHandlers(deps);
    const c = h["conversation.create"]({});
    h["persona.upsert"]({
      persona: {
        name: "hot",
        systemPrompt: "You are terse.",
        params: { temperature: 0.9 },
      },
    });
    h["conversation.setPersona"]({
      conversationId: c.id,
      personaName: "hot",
    });
    h["chat.send"]({ conversationId: c.id, content: "hello" });
    await settle();
    expect(prompts.at(-1)).toContain("System: You are terse.");
    expect(paramsSeen.at(-1)?.temperature).toBe(0.9);
  });

  test("model override beats persona params", async () => {
    const { deps, paramsSeen } = makeDeps({
      modelOverrides: { "m.gguf": { temperature: 0.1 } },
    });
    const h = createRequestHandlers(deps);
    const c = h["conversation.create"]({});
    h["persona.upsert"]({
      persona: {
        name: "hot",
        systemPrompt: "s",
        params: { temperature: 0.9 },
      },
    });
    h["conversation.setPersona"]({
      conversationId: c.id,
      personaName: "hot",
    });
    h["chat.send"]({ conversationId: c.id, content: "hi" });
    await settle();
    expect(paramsSeen.at(-1)?.temperature).toBe(0.1);
  });

  test("unassigned convs get no system block; assignments are isolated", async () => {
    const { deps, prompts } = makeDeps();
    const h = createRequestHandlers(deps);
    const a = h["conversation.create"]({});
    const b = h["conversation.create"]({});
    h["persona.upsert"]({
      persona: { name: "p1", systemPrompt: "ONLY-A", params: null },
    });
    h["conversation.setPersona"]({ conversationId: a.id, personaName: "p1" });
    h["chat.send"]({ conversationId: a.id, content: "x" });
    await settle(); // single-flight: the turn must end before the next send
    h["chat.send"]({ conversationId: b.id, content: "y" });
    await settle();
    expect(prompts[0]).toContain("ONLY-A");
    expect(prompts[1]).not.toContain("ONLY-A");
  });

  test("persona.delete clears assignment; conv still generates (SC-004)", async () => {
    const { deps, prompts } = makeDeps();
    const h = createRequestHandlers(deps);
    const c = h["conversation.create"]({});
    h["persona.upsert"]({
      persona: { name: "doomed", systemPrompt: "GONE", params: null },
    });
    h["conversation.setPersona"]({
      conversationId: c.id,
      personaName: "doomed",
    });
    expect(h["persona.usage"]({ name: "doomed" }).count).toBe(1);
    expect(h["persona.delete"]({ name: "doomed" })).toEqual({ cleared: 1 });
    expect(
      h["conversation.get"]({ conversationId: c.id }).personaName,
    ).toBeNull();
    h["chat.send"]({ conversationId: c.id, content: "still works" });
    await settle();
    expect(prompts.at(-1)).not.toContain("GONE");
  });
});

describe("persona management (T012) + snippets (T014)", () => {
  test("upsert persists through a fresh handler's persona.list", () => {
    const { deps } = makeDeps();
    const h = createRequestHandlers(deps);
    h["persona.upsert"]({
      persona: { name: "mine", systemPrompt: "S", params: { topP: 0.8 } },
    });
    // a second handler over the same store sees it (persistence seam)
    const h2 = createRequestHandlers(deps);
    const found = h2["persona.list"]({}).personas.find(
      (p) => p.name === "mine",
    );
    expect(found?.systemPrompt).toBe("S");
    expect(found?.params?.topP).toBe(0.8);
  });

  test("duplicate flow: copy under a new slug coexists with the original", () => {
    const { deps } = makeDeps();
    const h = createRequestHandlers(deps);
    const src = { name: "tutor", systemPrompt: "x", params: null };
    const copy = { ...src, name: "tutor-copy", systemPrompt: "y" };
    h["persona.upsert"]({ persona: copy });
    const names = h["persona.list"]({}).personas.map((p) => p.name);
    expect(names).toContain("tutor");
    expect(names).toContain("tutor-copy");
    // same-slug collision still rejected for a *new* persona? no — upsert
    // is create-or-update; duplicates rely on the client choosing a slug.
  });

  test("validation rejections -> INVALID_PARAMS", () => {
    const { deps } = makeDeps();
    const h = createRequestHandlers(deps);
    for (const p of [
      { name: "Bad Name", systemPrompt: "s", params: null },
      { name: "ok", systemPrompt: "", params: null },
      { name: "big", systemPrompt: "x".repeat(9 * 1024), params: null },
      { name: "pt", systemPrompt: "s", params: null, preferredTag: "nope" },
      {
        name: "pv",
        systemPrompt: "s",
        params: { temperature: 99 } as never,
      },
    ]) {
      try {
        h["persona.upsert"]({ persona: p as never });
        expect.unreachable();
      } catch (e) {
        expect((e as EngineError).code).toBe("INVALID_PARAMS");
      }
    }
  });

  test("snippet round-trip + persona-name collision -> INVALID_PARAMS", () => {
    const { deps } = makeDeps();
    const h = createRequestHandlers(deps);
    h["snippet.upsert"]({ snippet: { name: "sum", text: "Summarize this." } });
    expect(h["snippet.list"]({}).snippets).toEqual([
      { name: "sum", text: "Summarize this." },
    ]);
    h["snippet.upsert"]({ snippet: { name: "sum", text: "v2" } });
    expect(h["snippet.list"]({}).snippets[0].text).toBe("v2");
    try {
      h["snippet.upsert"]({ snippet: { name: "tutor", text: "x" } });
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("INVALID_PARAMS");
    }
    expect(h["snippet.delete"]({ name: "sum" })).toEqual({ deleted: true });
    expect(h["snippet.delete"]({ name: "sum" })).toEqual({ deleted: false });
  });
});
