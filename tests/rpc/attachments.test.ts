// RPC tests for feature 009: attachment pick → send → prompt injection,
// budget warnings, regenerate reuse, delete gc.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EngineError } from "../../src/bun/llama/engine";
import type {
  EngineLike,
  HandlerDeps,
  StoreLike,
} from "../../src/bun/rpc/handlers";
import type { Conversation, Settings } from "../../src/shared/types";
import { DEFAULT_GENERATION } from "../../src/shared/types";

let dataDir: string;
let createRequestHandlers: typeof import("../../src/bun/rpc/handlers").createRequestHandlers;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "att-rpc-"));
  process.env.APP_DATA_DIR = dataDir;
  ({ createRequestHandlers } = await import("../../src/bun/rpc/handlers"));
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.APP_DATA_DIR;
});

const FILE = join(tmpdir(), "att-rpc-src.ts");

function makeDeps(opts: { files?: string[] | null; ctxSize?: number } = {}) {
  const emitted: { method: string; payload: unknown }[] = [];
  const convs = new Map<string, Conversation>();
  let lastPrompt = "";
  let generating = false;

  const engine: EngineLike = {
    status: () => ({ status: "ready", name: "fake.gguf" }),
    loadModel: async () => ({ status: "ready", name: "fake.gguf" }),
    unloadModel: () => {},
    isGenerating: () => generating,
    contextSize: () => opts.ctxSize ?? 4096,
    chatTemplate: () => null,
    tokenCount: (t: string) => Math.ceil(t.length / 4),
    stop: () => {},
    generate: async (prompt, onToken) => {
      lastPrompt = prompt;
      generating = true;
      onToken("answer");
      generating = false;
      return { status: "complete", tokens: 1, elapsedMs: 1, warm: false };
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
    getSettings: () =>
      ({
        activeModelPath: null,
        contextLimitWarning: false,
        generation: DEFAULT_GENERATION,
        modelOverrides: {},
      }) as Settings,
    saveSettings: () => {},
  };

  const deps: HandlerDeps = {
    engine,
    store,
    emit: (m, p) => emitted.push({ method: m, payload: p }),
    dialogs: {
      pickFolder: async () => null,
      pickFile: async () => null,
      pickFiles: async () => opts.files ?? null,
    },
  };
  return {
    deps,
    emitted,
    convs,
    getLastPrompt: () => lastPrompt,
    h: createRequestHandlers(deps),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 10));
const CONV = "conv-1";

beforeAll(() => {
  writeFileSync(FILE, "export function attachable() { return 42; }\n");
});

describe("attachment.pick + chat.send", () => {
  test("pick stores files; send injects content into the prompt", async () => {
    const { h, convs, getLastPrompt } = makeDeps({ files: [FILE] });
    const pick = await h["attachment.pick"]({});
    expect(pick).not.toBeNull();
    expect(pick!.picked).toHaveLength(1);
    expect(pick!.picked[0]!.fileName).toBe("att-rpc-src.ts");
    expect(pick!.rejected).toHaveLength(0);

    const { messageId } = h["chat.send"]({
      conversationId: CONV,
      content: "what does attachable return?",
      attachmentIds: [pick!.picked[0]!.id],
    });
    await flush();
    // SC-001: file content reached the model
    expect(getLastPrompt()).toContain("return 42");
    expect(getLastPrompt()).toContain('<file name="att-rpc-src.ts"');
    // message record persisted + survives reload (SC-003)
    const conv = convs.get(CONV)!;
    const user = conv.messages.find((m) => m.role === "user")!;
    expect(user.attachments).toHaveLength(1);
    expect(user.attachments![0]!.status).toBe("full");
    expect(messageId).toBe(conv.messages.at(-1)!.id);
  });

  test("binary file lands in rejected at pick time (SC-004)", async () => {
    const bin = join(tmpdir(), "att-bin.so");
    writeFileSync(bin, new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x00]));
    const { h } = makeDeps({ files: [bin] });
    const pick = await h["attachment.pick"]({});
    expect(pick!.picked).toHaveLength(0);
    expect(pick!.rejected[0]!.reason).toContain("NUL");
  });

  test("cancelled picker returns null", async () => {
    const { h } = makeDeps({ files: null });
    expect(await h["attachment.pick"]({})).toBeNull();
  });

  test("unknown attachment id -> INVALID_PARAMS", async () => {
    const { h } = makeDeps({ files: null });
    try {
      h["chat.send"]({
        conversationId: "c2",
        content: "hi",
        attachmentIds: ["bogus-id"],
      });
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("INVALID_PARAMS");
    }
  });
});

describe("budget fit (US2)", () => {
  test("oversized attachment truncates + warns, generation still succeeds (SC-002)", async () => {
    const big = join(tmpdir(), "att-big.txt");
    writeFileSync(big, Array.from({ length: 5000 }, (_, i) => `line ${i}`).join("\n"));
    const { h, convs, emitted, getLastPrompt } = makeDeps({
      files: [big],
      ctxSize: 512, // small ctx -> budget ~256 -> file can't fit whole
    });
    const pick = await h["attachment.pick"]({});
    h["chat.send"]({
      conversationId: "c3",
      content: "summarize",
      attachmentIds: [pick!.picked[0]!.id],
    });
    await flush();
    const warn = emitted.find((e) => e.method === "chat.warning");
    expect(warn).toBeDefined();
    expect((warn!.payload as { code: string }).code).toBe("ATTACHMENTS_BUDGET");
    const user = convs.get("c3")!.messages.find((m) => m.role === "user")!;
    expect(user.attachments![0]!.status).toBe("truncated");
    expect(getLastPrompt()).toContain("… [truncated]");
    // generation still produced an answer
    const asst = convs.get("c3")!.messages.at(-1)!;
    expect(asst.status).toBe("complete");
  });
});

describe("regenerate + lifecycle", () => {
  test("regenerate re-injects the same attachment content (FR-009)", async () => {
    const { h, convs, getLastPrompt } = makeDeps({ files: [FILE] });
    const pick = await h["attachment.pick"]({});
    const { messageId } = h["chat.send"]({
      conversationId: "c4",
      content: "explain",
      attachmentIds: [pick!.picked[0]!.id],
    });
    await flush();
    const firstPrompt = getLastPrompt();
    h["chat.regenerate"]({ messageId });
    await flush();
    const regenPrompt = getLastPrompt();
    // sibling variant regenerated with identical injected file content
    expect(regenPrompt).toContain("return 42");
    expect(regenPrompt).toContain('<file name="att-rpc-src.ts"');
    expect(regenPrompt).toBe(firstPrompt);
  });

  test("conversation.delete gc's attachment files", async () => {
    const { h, convs } = makeDeps({ files: [FILE] });
    const pick = await h["attachment.pick"]({});
    h["chat.send"]({
      conversationId: "c5",
      content: "q",
      attachmentIds: [pick!.picked[0]!.id],
    });
    await flush();
    const attId = convs.get("c5")!.messages[0]!.attachments![0]!.id;
    const store = await import("../../src/bun/attachments/store");
    expect(() => store.readAttachment(attId)).not.toThrow();
    h["conversation.delete"]({ conversationId: "c5" });
    try {
      store.readAttachment(attId);
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("INVALID_PARAMS");
    }
  });
});
