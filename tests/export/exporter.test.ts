import { describe, expect, test } from "bun:test";
import {
  buildBackupEnvelope,
  buildEnvelope,
  renderMarkdown,
  slugify,
  toExportedSettings,
  uniqueFileName,
} from "../../src/bun/export/exporter";
import { EXPORT_FORMAT_VERSION } from "../../src/shared/export";
import type {
  Conversation,
  Message,
  Settings,
} from "../../src/shared/types";
import { DEFAULT_GENERATION } from "../../src/shared/types";

function msg(
  id: string,
  role: Message["role"],
  parentId: string | null,
  content = `content-${id}`,
  overrides: Partial<Message> = {},
): Message {
  return {
    id,
    conversationId: "c1",
    role,
    content,
    status: "complete",
    createdAt: "2025-01-01T00:00:00.000Z",
    completedAt: "2025-01-01T00:00:01.000Z",
    parentId,
    ...overrides,
  };
}

function conv(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "c1",
    title: "Test Conv",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:01.000Z",
    mode: "single",
    plannerTag: "planner",
    executorTag: "executor",
    activeLeaf: null,
    messages: [msg("u1", "user", null, "hi"), msg("a1", "assistant", "u1", "hello")],
    ...overrides,
  };
}

const settings = (p: Partial<Settings> = {}): Settings => ({
  activeModelPath: "/home/user/models/foo.gguf",
  contextLimitWarning: true,
  generation: DEFAULT_GENERATION,
  modelOverrides: { "foo.gguf": { temperature: 0.5 } },
  tags: [],
  ...p,
});

describe("envelope", () => {
  test("conversation envelope carries version/app/kind + verbatim conv", () => {
    const c = conv({ activeLeaf: "a1" });
    const env = buildEnvelope(c);
    expect(env.formatVersion).toBe(EXPORT_FORMAT_VERSION);
    expect(env.app).toBe("ai-desktop-app");
    expect(env.kind).toBe("conversation");
    expect(env.conversations).toHaveLength(1);
    expect(env.conversations[0]).toBe(c); // verbatim incl. parentId/activeLeaf
    expect(env.settings).toBeUndefined();
    expect(env.tags).toBeUndefined();
  });

  test("backup envelope includes settings + tags, activeModel as basename", () => {
    const s = settings();
    const env = buildBackupEnvelope([conv()], s, [
      { name: "default", binding: "foo.gguf", params: {}, fallback: [] },
    ]);
    expect(env.kind).toBe("backup");
    expect(env.settings?.activeModel).toBe("foo.gguf");
    expect(env.settings?.generation).toEqual(DEFAULT_GENERATION);
    expect(env.tags).toHaveLength(1);
  });

  test("no absolute paths anywhere in serialized envelope (FR-003)", () => {
    const env = buildBackupEnvelope(
      [conv()],
      settings({ activeModelPath: "/home/user/secret/models/x.gguf" }),
      [{ name: "default", binding: "x.gguf", params: {}, fallback: [] }],
    );
    const raw = JSON.stringify(env);
    expect(raw).not.toContain("/home/");
    expect(raw).not.toMatch(/[A-Za-z]:\\/);
    expect(toExportedSettings(settings()).activeModel).toBe("foo.gguf");
  });
});

describe("renderMarkdown", () => {
  test("renders the active path with speaker blocks", () => {
    const md = renderMarkdown(conv());
    expect(md).toContain("# Test Conv");
    expect(md).toContain("**You**");
    expect(md).toContain("hi");
    expect(md).toContain("**Assistant**");
    expect(md).toContain("hello");
  });

  test("dead branches excluded; variants get markers (feature 005)", () => {
    const c = conv({
      messages: [
        msg("u1", "user", null, "hi"),
        msg("a1", "assistant", "u1", "first"),
        msg("a2", "assistant", "u1", "second"),
      ],
      activeLeaf: "a2",
    });
    const md = renderMarkdown(c);
    expect(md).toContain("second");
    expect(md).not.toContain("first");
    expect(md).toContain("variant 2 of 2");
  });

  test("fusion plan renders as <details> block; status labels shown", () => {
    const c = conv({
      messages: [
        msg("u1", "user", null),
        msg("a1", "assistant", "u1", "answer", {
          status: "partial",
          phases: {
            plan: { content: "plan steps", tag: "planner", fileName: "p.gguf" },
          },
        }),
      ],
    });
    const md = renderMarkdown(c);
    expect(md).toContain("<details><summary>Plan — planner · p.gguf");
    expect(md).toContain("plan steps");
    expect(md).toContain("</details>");
    expect(md).toContain("*(partial)*");
  });
});

describe("file names", () => {
  test("slugify strips non-alphanumerics", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("!!!")).toBe("conversation");
  });

  test("uniqueFileName dedups via exists()", () => {
    const taken = new Set(["test-conv-abcd1234.md"]);
    expect(uniqueFileName("Test Conv", "abcd1234-ffff", "md", (n) => taken.has(n))).toBe(
      "test-conv-abcd1234-2.md",
    );
    expect(uniqueFileName("Test Conv", "abcd1234-ffff", "md", () => false)).toBe(
      "test-conv-abcd1234.md",
    );
  });
});
