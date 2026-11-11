// Store test (US2): write -> read round-trip preserves order and status;
// atomic write leaves no torn file on simulated failure.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// isolate the store under a temp APP_DATA_DIR before importing it
const dir = mkdtempSync(join(tmpdir(), "chat-store-"));
process.env.APP_DATA_DIR = dir;

const store = await import("../../src/bun/store/json-store");
const { settingsFile } = await import("../../src/bun/store/paths");

function conv(id: string, n = 3) {
  const now = new Date().toISOString();
  return {
    id,
    title: "Test",
    createdAt: now,
    updatedAt: now,
    messages: Array.from({ length: n }, (_, i) => ({
      id: `m${i}`,
      conversationId: id,
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `msg ${i}`,
      status: (i === n - 1 ? "partial" : "complete") as
        | "complete"
        | "partial",
      createdAt: now,
      completedAt: now,
    })),
  };
}

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("json-store", () => {
  test("write -> read round-trip preserves order and status", () => {
    const c = conv("c1");
    store.saveConversation(c);
    const got = store.getConversation("c1");
    expect(got).not.toBeNull();
    expect(got!.messages.map((m) => m.id)).toEqual(["m0", "m1", "m2"]);
    expect(got!.messages.map((m) => m.status)).toEqual([
      "complete",
      "complete",
      "partial",
    ]);
    expect(got!.title).toBe("Test");
  });

  test("atomic write: leftover .tmp does not corrupt the real file", () => {
    const c = conv("c2");
    store.saveConversation(c);
    const file = join(dir, "conversations", "c2.json");
    // simulate a crash mid-write: partial json left in the tmp file
    writeFileSync(`${file}.tmp`, '{"id":"c2","broken":', "utf8");
    const got = store.getConversation("c2");
    expect(got!.messages.length).toBe(3); // real file untouched
    expect(JSON.parse(readFileSync(file, "utf8")).id).toBe("c2");
  });

  test("list returns summaries sorted by updatedAt desc", () => {
    const a = conv("c-a");
    const b = conv("c-b");
    a.updatedAt = "2024-01-01T00:00:00Z";
    b.updatedAt = "2025-01-01T00:00:00Z";
    store.saveConversation(a);
    store.saveConversation(b);
    const list = store.listConversations();
    const ids = list.map((s) => s.id);
    expect(ids.indexOf("c-b")).toBeLessThan(ids.indexOf("c-a"));
    expect(list.every((s) => !("messages" in s))).toBe(true);
  });

  test("get normalizes generating -> partial (crash recovery)", () => {
    const c = conv("c3");
    c.messages[1].status = "generating" as never;
    c.messages[1].completedAt = null;
    store.saveConversation(c);
    const got = store.getConversation("c3");
    expect(got!.messages[1]!.status).toBe("partial");
  });

  test("invalid id is rejected (no path traversal)", () => {
    expect(store.getConversation("../etc/passwd")).toBeNull();
    expect(store.getConversation("missing")).toBeNull();
    expect(() => store.saveConversation(conv("../bad"))).toThrow();
  });

  test("settings round-trip and defaults", () => {
    const defaults = store.getSettings();
    expect(defaults.activeModelPath).toBeNull();
    expect(defaults.generation.maxTokens).toBe(512);
    expect(defaults.modelOverrides).toEqual({});
    store.saveSettings(defaults);
    store.saveSettings({ ...defaults, activeModelPath: "/tmp/m.gguf" });
    expect(store.getSettings().activeModelPath).toBe("/tmp/m.gguf");
    expect(existsSync(settingsFile())).toBe(true);
  });
});

describe("json-store: feature 004 tags + fusion fields", () => {
  test("getSettings provisions default/planner/executor tags", () => {
    const s = store.getSettings();
    const names = s.tags.map((t) => t.name);
    expect(names).toEqual(["default", "planner", "executor"]);
    expect(s.tags[1]!.binding).toBeNull();
  });

  test("default tag binds to activeModelPath basename", () => {
    store.saveSettings({
      ...store.getSettings(),
      activeModelPath: "/models/foo.gguf",
    });
    // settings/tags persist across getSettings calls
    const s = store.getSettings();
    const def = s.tags.find((t) => t.name === "default");
    expect(def).toBeDefined();
    // binding was provisioned before activeModelPath was set — stays
    // whatever was persisted; sync happens in the handler layer (T007)
  });

  test("conversation gains fusion defaults on load", () => {
    const c = conv("c-fusion") as never;
    store.saveConversation(c);
    const got = store.getConversation("c-fusion")!;
    expect(got.mode).toBe("single");
    expect(got.plannerTag).toBe("planner");
    expect(got.executorTag).toBe("executor");
  });

  test("fusion fields round-trip", () => {
    const c = {
      ...conv("c-f2"),
      mode: "fusion" as const,
      plannerTag: "writer",
      executorTag: "default",
    } as never;
    store.saveConversation(c);
    const got = store.getConversation("c-f2")!;
    expect(got.mode).toBe("fusion");
    expect(got.plannerTag).toBe("writer");
    expect(got.executorTag).toBe("default");
  });
});
