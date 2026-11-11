// feature 007 (T005): index semantics — literal multi-term AND,
// case-insensitive, terminal-state only, plan-phase coverage,
// updatedAt-keyed refresh/eviction, group ordering + caps, snippets.
import { describe, expect, test } from "bun:test";
import { SearchIndex } from "../../src/bun/search/index";
import type { Conversation, Message } from "../../src/shared/types";

function msg(
  id: string,
  role: "user" | "assistant",
  content: string,
  status: Message["status"] = "complete",
  extra?: Partial<Message>,
): Message {
  return {
    id,
    conversationId: "c",
    role,
    content,
    status,
    createdAt: "2026-01-01T00:00:00Z",
    completedAt: null,
    parentId: null,
    ...extra,
  };
}

function conv(
  id: string,
  title: string,
  updatedAt: string,
  messages: Message[],
): Conversation {
  return {
    id,
    title,
    createdAt: updatedAt,
    updatedAt,
    messages,
    mode: "single",
  } as Conversation;
}

function makeStore() {
  const convs = new Map<string, Conversation>();
  return {
    convs,
    store: {
      listConversations: () =>
        [...convs.values()].map((c) => ({
          id: c.id,
          title: c.title,
          updatedAt: c.updatedAt,
        })),
      getConversation: (id: string) => convs.get(id) ?? null,
    },
  };
}

describe("SearchIndex", () => {
  test("multi-term AND + case-insensitive + literal specials", () => {
    const { convs, store } = makeStore();
    convs.set(
      "c1",
      conv("c1", "Chat", "2026-01-02", [
        msg("m1", "user", "Tell me about C++ Templates"),
        msg("m2", "assistant", "C++ uses [template] syntax"),
      ]),
    );
    const idx = new SearchIndex(store);
    const r = idx.query("c++ template");
    expect(r.groups).toHaveLength(1);
    // both hit: "template" is a substring of m1's "Templates" (literal)
    expect(r.groups[0].hits.map((h) => h.messageId)).toEqual(["m1", "m2"]);
    // but "templates" is NOT a substring of "[template]" — m1 alone
    const only = idx.query("c++ TEMPLATES").groups[0].hits;
    expect(only.map((h) => h.messageId)).toEqual(["m1"]);
    expect(idx.query("[foo] bar").groups).toEqual([]); // literal, no crash
  });

  test("generating/failed excluded; completes appear after refresh", () => {
    const { convs, store } = makeStore();
    const m = msg("m1", "assistant", "partial draft", "generating");
    convs.set("c1", conv("c1", "Chat", "2026-01-02", [m]));
    const idx = new SearchIndex(store);
    expect(idx.query("draft").groups).toEqual([]);
    // simulate completion: status flips AND updatedAt bumps (T006 fix)
    m.status = "complete";
    convs.get("c1")!.updatedAt = "2026-01-03";
    expect(idx.query("draft").groups[0].hits[0].messageId).toBe("m1");
  });

  test("plan-phase content is searchable (FR-007)", () => {
    const { convs, store } = makeStore();
    convs.set(
      "c1",
      conv("c1", "Chat", "2026-01-02", [
        msg("m1", "assistant", "answer", "complete", {
          phases: {
            plan: { content: "step one: frobnicate the widget", tag: "p", fileName: "f" },
          },
        }),
      ]),
    );
    const idx = new SearchIndex(store);
    expect(idx.query("frobnicate").groups[0].hits[0].messageId).toBe("m1");
  });

  test("deleted conversations evict on next query", () => {
    const { convs, store } = makeStore();
    convs.set("c1", conv("c1", "Chat", "2026-01-02", [msg("m1", "user", "needle")]));
    const idx = new SearchIndex(store);
    expect(idx.query("needle").groups).toHaveLength(1);
    convs.delete("c1");
    expect(idx.query("needle").groups).toEqual([]);
  });

  test("groups order by updatedAt desc; title-only matches surface", () => {
    const { convs, store } = makeStore();
    convs.set("old", conv("old", "zzz", "2026-01-01", [msg("a", "user", "krypto")]));
    convs.set("new", conv("new", "zzz", "2026-01-05", [msg("b", "user", "krypto")]));
    convs.set("titled", conv("titled", "Krypto notes", "2026-01-03", [msg("c", "user", "unrelated")]));
    const idx = new SearchIndex(store);
    const g = idx.query("krypto").groups;
    expect(g.map((x) => x.conversationId)).toEqual(["new", "titled", "old"]);
    expect(g[1].titleMatched).toBe(true);
    expect(g[1].hits).toEqual([]);
  });

  test("caps: 20 groups / 3 hits per group", () => {
    const { convs, store } = makeStore();
    for (let i = 0; i < 25; i++) {
      convs.set(
        `c${i}`,
        conv(`c${i}`, "t", `2026-01-${String(i + 1).padStart(2, "0")}`, [
          msg(`m${i}`, "user", "term"),
        ]),
      );
    }
    convs.set(
      "many",
      conv("many", "t", "2026-02-01",
        [1, 2, 3, 4, 5].map((n) => msg(`h${n}`, "user", `term ${n}`)),
      ),
    );
    const idx = new SearchIndex(store);
    const r = idx.query("term");
    expect(r.groups).toHaveLength(20);
    expect(r.groups[0].conversationId).toBe("many");
    expect(r.groups[0].hits).toHaveLength(3);
    expect(r.groups[0].hits.map((h) => h.messageId)).toEqual(["h1", "h2", "h3"]);
  });

  test("snippet centers the first match with a char range", () => {
    const { convs, store } = makeStore();
    const body = "x".repeat(100) + "needle" + "y".repeat(100);
    convs.set("c1", conv("c1", "t", "2026-01-02", [msg("m1", "user", body)]));
    const idx = new SearchIndex(store);
    const hit = idx.query("needle").groups[0].hits[0];
    expect(hit.snippet).toContain("needle");
    expect(hit.snippet.slice(hit.matchStart, hit.matchEnd)).toBe("needle");
    expect(hit.snippet.length).toBeLessThan(95);
    expect(hit.snippet.startsWith("…")).toBe(true);
  });

  test("short/blank queries never touch the index", () => {
    const { convs, store } = makeStore();
    convs.set("c1", conv("c1", "t", "2026-01-02", [msg("m1", "user", "ab")]));
    const idx = new SearchIndex(store);
    expect(idx.query("").groups).toEqual([]);
    expect(idx.query("  ").groups).toEqual([]);
    expect(idx.query("ab").groups).toEqual([]); // <3 chars
  });
});
