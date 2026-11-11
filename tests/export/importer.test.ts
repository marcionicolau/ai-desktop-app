import { describe, expect, test } from "bun:test";
import {
  parseEnvelope,
  remapConversation,
  toSettings,
} from "../../src/bun/export/importer";
import {
  buildBackupEnvelope,
  buildEnvelope,
} from "../../src/bun/export/exporter";
import { EngineError } from "../../src/bun/llama/engine";
import type { Conversation, Message } from "../../src/shared/types";

function msg(
  id: string,
  role: Message["role"],
  parentId: string | null,
): Message {
  return {
    id,
    conversationId: "c1",
    role,
    content: `content-${id}`,
    status: "complete",
    createdAt: "2025-01-01T00:00:00.000Z",
    completedAt: "2025-01-01T00:00:01.000Z",
    parentId,
  };
}

// branched tree: u1 -> a1 | a2 -> u2 -> a3  (active leaf a3)
const conv = (): Conversation => ({
  id: "c1",
  title: "Tree",
  createdAt: "t",
  updatedAt: "t",
  mode: "single",
  plannerTag: "planner",
  executorTag: "executor",
  activeLeaf: "a3",
  messages: [
    msg("u1", "user", null),
    msg("a1", "assistant", "u1"),
    msg("a2", "assistant", "u1"),
    msg("u2", "user", "a2"),
    msg("a3", "assistant", "u2"),
  ],
});

describe("parseEnvelope", () => {
  test("accepts a well-formed envelope", () => {
    const env = parseEnvelope(JSON.stringify(buildEnvelope(conv())));
    expect(env.kind).toBe("conversation");
    expect(env.conversations[0]!.messages).toHaveLength(5);
  });

  test.each([
    ["not json", "not a JSON file"],
    ["{}", "unsupported format version undefined"],
    [JSON.stringify({ formatVersion: 99 }), "unsupported format version 99"],
    [
      JSON.stringify({ formatVersion: 1, app: "other", kind: "x", conversations: [1] }),
      "not an ai-desktop-app export",
    ],
    [
      JSON.stringify({ formatVersion: 1, app: "ai-desktop-app", kind: "weird", conversations: [1] }),
      "unknown export kind",
    ],
    [
      JSON.stringify({ formatVersion: 1, app: "ai-desktop-app", kind: "conversation", conversations: [] }),
      "no conversations in file",
    ],
    [
      JSON.stringify({
        formatVersion: 1, app: "ai-desktop-app", kind: "conversation",
        conversations: [{ messages: [{ id: 1 }] }],
      }),
      "malformed message at index 0",
    ],
  ])("rejects invalid input -> %s", (raw, expected) => {
    try {
      parseEnvelope(raw);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EngineError);
      expect((e as EngineError).code).toBe("INVALID_PARAMS");
      expect((e as EngineError).message).toContain(expected);
    }
  });
});

describe("remapConversation", () => {
  test("fresh ids; parentId/activeLeaf links survive (tree intact)", () => {
    const r = remapConversation(conv(), false);
    const byContent = new Map(r.messages.map((m) => [m.content, m]));
    expect(r.id).not.toBe("c1");
    expect(r.messages.every((m) => m.conversationId === r.id)).toBe(true);
    // tree shape preserved through the id map
    expect(byContent.get("content-a1")!.parentId).toBe(byContent.get("content-u1")!.id);
    expect(byContent.get("content-a2")!.parentId).toBe(byContent.get("content-u1")!.id);
    expect(byContent.get("content-a3")!.parentId).toBe(byContent.get("content-u2")!.id);
    expect(r.activeLeaf).toBe(byContent.get("content-a3")!.id);
    // all ids fresh
    expect(r.messages.every((m) => !["u1", "a1", "a2", "u2", "a3"].includes(m.id))).toBe(true);
  });

  test("dangling parentId refs collapse to null", () => {
    const c = conv();
    c.messages[1]!.parentId = "ghost-id";
    const r = remapConversation(c, false);
    expect(r.messages[1]!.parentId).toBeNull();
  });

  test("title collision appends (imported)", () => {
    expect(remapConversation(conv(), true).title).toBe("Tree (imported)");
    expect(remapConversation(conv(), false).title).toBe("Tree");
  });

  test("missing activeLeaf falls back to last message", () => {
    const c = conv();
    c.activeLeaf = null;
    const r = remapConversation(c, false);
    expect(r.activeLeaf).toBe(r.messages.at(-1)!.id);
  });
});

describe("toSettings", () => {
  const imported = {
    generation: { temperature: 0.7 } as never,
    modelOverrides: {},
    contextLimitWarning: true,
    activeModel: "present.gguf",
  };
  const provisioned = [
    { name: "default", binding: null, params: {}, fallback: [] },
    { name: "planner", binding: null, params: {}, fallback: [] },
  ];

  test("merges imported + provisioned tags; resolves activeModel when file exists", () => {
    const s = toSettings(
      imported,
      [{ name: "custom", binding: "x.gguf", params: {}, fallback: [] }],
      "/tmp/nope",
      provisioned,
    );
    expect(s.tags.map((t) => t.name).toSorted()).toEqual([
      "custom",
      "default",
      "planner",
    ]);
    expect(s.activeModelPath).toBeNull(); // /tmp/nope/present.gguf absent
    // bindings stay verbatim even when the file is absent (broken state)
    expect(s.tags[0]!.binding).toBe("x.gguf");
  });
});
