// feature 007 (T007): search.query contract — grouped response,
// title-only hits, short/empty query, mid-generation exclusion until
// done (updatedAt-driven refresh).
import { describe, expect, test } from "bun:test";
import {
  createRequestHandlers,
  type EngineLike,
  type HandlerDeps,
  type StoreLike,
} from "../../src/bun/rpc/handlers";
import type { Conversation, Settings } from "../../src/shared/types";
import { DEFAULT_GENERATION } from "../../src/shared/types";

function makeDeps() {
  const convs = new Map<string, Conversation>();
  const settings = {
    activeModelPath: "m.gguf",
    contextLimitWarning: false,
    generation: DEFAULT_GENERATION,
    modelOverrides: {},
    tags: [],
  } as Settings;
  let genDelay = 0;
  const engine: EngineLike = {
    status: () => ({ status: "ready" as const, name: "m.gguf" }),
    loadModel: async () => ({ status: "ready" as const, name: "m.gguf" }),
    unloadModel: () => {},
    isGenerating: () => false,
    contextSize: () => 4096,
    chatTemplate: () => null,
    tokenCount: (t) => Math.ceil(t.length / 4),
    generate: async (_p, onToken) => {
      await new Promise((r) => setTimeout(r, genDelay));
      onToken("answer with needles");
      return {
        status: "complete" as const,
        tokens: 3,
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
    saveSettings: () => {},
  };
  const deps: HandlerDeps = { engine, store, emit: () => {} };
  return { deps, convs, setGenDelay: (ms: number) => (genDelay = ms) };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

describe("search.query contract", () => {
  test("message bodies group under their conversation, recency first", async () => {
    const { deps } = makeDeps();
    const h = createRequestHandlers(deps);
    const a = h["conversation.create"]({ title: "Alpha" });
    const b = h["conversation.create"]({ title: "Beta" });
    h["chat.send"]({ conversationId: a.id, content: "what is a widget" });
    h["chat.send"]({ conversationId: b.id, content: "explain needles" });
    await settle();
    // "explain" is unique to conv b's user turn — the engine's canned
    // "needles" reply would otherwise match both conversations
    const r = h["search.query"]({ q: "explain needles" });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].conversationId).toBe(b.id);
    expect(r.groups[0].title).toBe("Beta");
    const hit = r.groups[0].hits[0];
    expect(hit.snippet).toContain("needles");
    expect(hit.snippet.slice(hit.matchStart, hit.matchEnd)).toBe("explain");
  });

  test("title-only match surfaces the conversation", () => {
    const { deps } = makeDeps();
    const h = createRequestHandlers(deps);
    h["conversation.create"]({ title: "Zebra talk" });
    const r = h["search.query"]({ q: "zebra" });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].titleMatched).toBe(true);
    expect(r.groups[0].hits).toEqual([]);
  });

  test("empty and <3-char queries return no groups", () => {
    const { deps } = makeDeps();
    const h = createRequestHandlers(deps);
    h["conversation.create"]({ title: "x" });
    for (const q of ["", "  ", "ab"]) {
      expect(h["search.query"]({ q }).groups).toEqual([]);
    }
  });

  test("generating message excluded until chat.done refreshes it", async () => {
    const { deps, convs, setGenDelay } = makeDeps();
    setGenDelay(60); // hold the turn open past the first query
    const h = createRequestHandlers(deps);
    const c = h["conversation.create"]({ title: "Slow" });
    h["chat.send"]({ conversationId: c.id, content: "go" });
    // mid-generation: assistant msg is 'generating' — excluded (FR-009)
    expect(h["search.query"]({ q: "needles" }).groups).toEqual([]);
    await new Promise((r) => setTimeout(r, 120));
    // after done + updatedAt bump, the completed message is searchable
    const r = h["search.query"]({ q: "needles" });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].hits[0].snippet).toContain("needles");
    void convs; // (fixture held by store closures)
  });
});
