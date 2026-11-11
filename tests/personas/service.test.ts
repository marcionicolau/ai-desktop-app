// T005: PersonaService — seed-on-read, validation, uniqueness,
// delete-clears-assignments, snippets.
import { describe, expect, test } from "bun:test";
import { PersonaService } from "../../src/bun/personas/service";
import type { Persona } from "../../src/shared/types";
import { DEFAULT_GENERATION } from "../../src/shared/types";

function makeDeps() {
  const settings = {
    activeModelPath: null,
    contextLimitWarning: false,
    generation: DEFAULT_GENERATION,
    modelOverrides: {},
    tags: [],
  } as import("../../src/shared/types").Settings;
  const convs = new Map<
    string,
    { id: string; title: string; updatedAt: string; personaName?: string | null }
  >();
  const store = {
    getSettings: () => settings,
    saveSettings: (s: typeof settings) => Object.assign(settings, s),
    listConversations: () => [...convs.values()],
    getConversation: (id: string) => convs.get(id) ?? null,
    saveConversation: (c: never) => {},
    deleteConversation: () => false,
  };
  return {
    settings,
    convs,
    svc: new PersonaService({
      store: store as never,
      tagNames: () => ["default", "coder"],
      getConversation: (id) => convs.get(id) ?? null,
      saveConversation: (c) => convs.set((c as { id: string }).id, c as never),
    }),
  };
}

describe("PersonaService", () => {
  test("seed-on-read: unset personas materialize starters", () => {
    const { svc, settings } = makeDeps();
    const list = svc.list();
    expect(list.map((p) => p.name)).toEqual(["concise", "tutor", "coder"]);
    expect(settings.personas).toHaveLength(3); // persisted
  });

  test("explicit [] stays empty — deleting all never re-seeds", () => {
    const { svc, settings } = makeDeps();
    settings.personas = [];
    expect(svc.list()).toEqual([]);
  });

  test("upsert validates slug, empty/oversized prompt, params, tag", () => {
    const { svc } = makeDeps();
    const base = { name: "x", systemPrompt: "s", params: null } as Persona;
    expect(() => svc.upsert({ ...base, name: "Bad Name" })).toThrow(/slug/);
    expect(() => svc.upsert({ ...base, name: "ok", systemPrompt: " " }))
      .not.toThrow(); // whitespace counts (bytes>0) — empty string fails:
    expect(() => svc.upsert({ ...base, name: "e2", systemPrompt: "" })).toThrow(
      /empty/,
    );
    expect(() =>
      svc.upsert({ ...base, name: "big", systemPrompt: "x".repeat(9 * 1024) }),
    ).toThrow(/exceeds/);
    expect(() =>
      svc.upsert({ ...base, name: "bp", params: { temperature: 99 } as never }),
    ).toThrow();
    expect(() =>
      svc.upsert({ ...base, name: "pt", preferredTag: "nope" }),
    ).toThrow(/preferredTag/);
    expect(svc.upsert({ ...base, name: "pt", preferredTag: "coder" }).name).toBe(
      "pt",
    );
  });

  test("upsert same name updates; new name creates (duplicate = re-slug)", () => {
    const { svc } = makeDeps();
    svc.upsert({ name: "mine", systemPrompt: "v1", params: null });
    svc.upsert({ name: "mine", systemPrompt: "v2", params: null });
    expect(svc.list().filter((p) => p.name === "mine")).toHaveLength(1);
    expect(svc.get("mine")?.systemPrompt).toBe("v2");
  });

  test("delete clears personaName on referencing convs + returns count", () => {
    const { svc, convs } = makeDeps();
    convs.set("c1", {
      id: "c1",
      title: "One",
      updatedAt: "t",
      personaName: "tutor",
    });
    convs.set("c2", {
      id: "c2",
      title: "Two",
      updatedAt: "t",
      personaName: "tutor",
    });
    convs.set("c3", { id: "c3", title: "Three", updatedAt: "t" });
    expect(svc.usage("tutor")).toEqual({
      count: 2,
      titles: ["One", "Two"],
    });
    expect(svc.delete("tutor").cleared).toBe(2);
    expect(convs.get("c1")?.personaName).toBeNull();
    expect(svc.get("tutor")).toBeNull();
    expect(() => svc.delete("tutor")).toThrow(/not found/);
  });

  test("snippets: round-trip, persona-name collision, delete", () => {
    const { svc } = makeDeps();
    svc.upsertSnippet({ name: "sum", text: "Summarize in 3 bullets." });
    expect(svc.snippets().map((s) => s.name)).toEqual(["sum"]);
    expect(() =>
      svc.upsertSnippet({ name: "tutor", text: "x" }),
    ).toThrow(/collides/);
    expect(svc.deleteSnippet("sum")).toBe(true);
    expect(svc.deleteSnippet("sum")).toBe(false);
  });
});
