// RPC handlers for the chat schema (contracts/rpc.md).
// createRequestHandlers is dependency-injected so tests/rpc can exercise the
// contract without the Electrobun bridge or a real model.
import { defineElectrobunRPC } from "electrobun/main/rpc";
import type { ChatRpcSchema, RpcErrorCode } from "../../shared/rpc-contract";
import type {
  Conversation,
  GenerationParams,
  Message,
  ModelStatus,
} from "../../shared/types";
import { DEFAULT_GENERATION } from "../../shared/types";
import { EngineError, LlamaEngine } from "../llama/engine";
import { mergeParams, validateParams } from "../llama/params";
import { buildPrompt, type PromptTurn } from "../llama/prompt";
import * as store from "../store/json-store";

type Events = ChatRpcSchema["webview"]["messages"];
type Emit = <M extends keyof Events>(method: M, payload: Events[M]) => void;

export interface EngineLike {
  status(): { status: ModelStatus; name?: string; error?: string };
  loadModel(path: string): Promise<{ status: "ready"; name: string }>;
  unloadModel(): void;
  isGenerating(): boolean;
  contextSize(): number;
  chatTemplate(): string | null;
  tokenCount(text: string): number;
  generate(
    prompt: string,
    onToken: (delta: string) => void,
    params?: GenerationParams | null,
    opts?: { conversationId?: string },
  ): Promise<{
    status: "complete" | "partial";
    tokens: number;
    elapsedMs: number;
    warm: boolean;
  }>;
  stop(): void;
}

export interface StoreLike {
  getConversation(id: string): Conversation | null;
  saveConversation(conv: Conversation): void;
  listConversations: typeof store.listConversations;
  deleteConversation: typeof store.deleteConversation;
  getSettings: typeof store.getSettings;
  saveSettings: typeof store.saveSettings;
}

export interface HandlerDeps {
  engine: EngineLike;
  emit: Emit;
  store: StoreLike;
}

function fail(code: RpcErrorCode, message: string): never {
  throw new EngineError(code, message);
}

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();

export function createRequestHandlers(deps: HandlerDeps) {
  let activeMessageId: string | null = null;

  const persist = (conv: Conversation) => deps.store.saveConversation(conv);

  const resolveGenParams = (): GenerationParams => {
    const settings = deps.store.getSettings();
    const modelKey = deps.engine.status().name ?? "";
    return mergeParams(
      mergeParams(DEFAULT_GENERATION, settings.generation),
      modelKey ? settings.modelOverrides?.[modelKey] : undefined,
    );
  };

  // turns strictly before the given message, newest-first, usable as
  // buildPrompt history
  const turnsBefore = (conv: Conversation, msgId: string): PromptTurn[] =>
    conv.messages
      .slice(
        0,
        conv.messages.findIndex((m) => m.id === msgId),
      )
      .filter((m) => m.status === "complete" || m.status === "partial")
      .reverse()
      .map((m) => ({ role: m.role, content: m.content }));

  const findMessage = (messageId: string) => {
    for (const summary of deps.store.listConversations()) {
      const conv = deps.store.getConversation(summary.id);
      const msg = conv?.messages.find((m) => m.id === messageId);
      if (conv && msg) return { conv, msg };
    }
    return null;
  };

  // shared generation driver for chat.send / chat.regenerate / chat.edit:
  // builds the budgeted prompt from (history, current), streams tokens into
  // assistantMsg, persists, and emits chat.token/done/error. FR-011: the
  // token budget halves and retries on real context overflow.
  const streamAssistant = (
    conv: Conversation,
    assistantMsg: Message,
    history: PromptTurn[],
    current: string,
  ): void => {
    const genParams = resolveGenParams();
    const ctxSize = deps.engine.contextSize();
    const reserve = Math.min(512, Math.floor(ctxSize / 2) || 512);
    const baseBudget = ctxSize > 0 ? ctxSize - reserve : Infinity;
    const chatml = (deps.engine.chatTemplate() ?? "").includes("im_start");
    const costOf = (t: { content: string }) =>
      deps.engine.tokenCount(t.content) + 8; // ~wrapper tokens per turn
    const messageId = assistantMsg.id;
    activeMessageId = messageId;

    // token-flush checkpoint: persist accumulated content ~every 500ms
    // during generation so a crash keeps near-complete state (T030)
    let dirty = false;
    const flushTimer = setInterval(() => {
      if (dirty) {
        dirty = false;
        persist(conv);
      }
    }, 500);

    let warned = false;
    const warnTruncated = () => {
      if (warned) return;
      warned = true;
      deps.emit("chat.warning", {
        messageId,
        code: "CONTEXT_TRUNCATED",
        message:
          "Message exceeded the model's context window; the oldest content was truncated.",
      });
    };
    const isCtxOverflow = (e: unknown) =>
      e instanceof Error && e.message.includes("context window");

    const run = async () => {
      let budget = baseBudget;
      for (;;) {
        const built = buildPrompt(history, current, {
          chatml,
          budget,
          costOf,
        });
        if (built.truncated) warnTruncated();
        try {
          return await deps.engine.generate(
            built.prompt,
            (delta) => {
              assistantMsg.content += delta;
              dirty = true;
              deps.emit("chat.token", { messageId, delta });
            },
            genParams,
            { conversationId: conv.id },
          );
        } catch (e) {
          if (!isCtxOverflow(e) || budget <= 256) throw e;
          budget = Math.floor(budget / 2);
        }
      }
    };

    void run()
      .then((res) => {
        assistantMsg.status = res.status;
        assistantMsg.completedAt = now();
        const stats =
          res.tokens > 0
            ? {
                tokens: res.tokens,
                tokensPerSec:
                  Math.round((res.tokens / (res.elapsedMs / 1000)) * 10) / 10,
              }
            : null;
        assistantMsg.stats = stats;
        persist(conv);
        deps.emit("chat.done", {
          messageId,
          status: res.status,
          stats: stats ?? undefined,
        });
      })
      .catch((e: unknown) => {
        assistantMsg.status = "failed";
        assistantMsg.completedAt = now();
        persist(conv);
        deps.emit("chat.error", {
          messageId,
          code: e instanceof EngineError ? e.code : "ENGINE_ERROR",
          message: e instanceof Error ? e.message : String(e),
        });
      })
      .finally(() => {
        clearInterval(flushTimer);
        if (activeMessageId === messageId) activeMessageId = null;
      });
  };

  return {
    "model.load": async ({ path }: { path: string }) => {
      deps.emit("model.progress", { phase: "loading" });
      try {
        const res = await deps.engine.loadModel(path);
        deps.emit("model.progress", { phase: "ready", detail: res.name });
        const settings = deps.store.getSettings();
        deps.store.saveSettings({ ...settings, activeModelPath: path });
        return res;
      } catch (e) {
        deps.emit("model.progress", {
          phase: "error",
          detail: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
    },
    "model.unload": () => {
      deps.engine.unloadModel();
      const settings = deps.store.getSettings();
      deps.store.saveSettings({ ...settings, activeModelPath: null });
      return {};
    },
    "model.pick": async () => {
      const { Utils } = await import("electrobun/main");
      const paths = await Utils.openFileDialog({
        startingFolder: "~/",
        allowedFileTypes: "gguf",
        canChooseFiles: true,
        canChooseDirectory: false,
        allowsMultipleSelection: false,
      });
      return { path: paths[0] ?? null };
    },
    "model.status": () => deps.engine.status(),
    "chat.send": ({
      conversationId,
      content,
    }: {
      conversationId: string;
      content: string;
    }) => {
      const text = content.trim();
      if (!text) fail("EMPTY_MESSAGE", "message must not be empty");
      if (deps.engine.isGenerating()) {
        fail("ENGINE_BUSY", "a generation is already in progress");
      }
      if (deps.engine.status().status !== "ready") {
        fail("NO_MODEL", "no model is loaded");
      }

      let conv = deps.store.getConversation(conversationId);
      if (!conv) {
        conv = {
          id: conversationId,
          title: text.slice(0, 40) || "New conversation",
          createdAt: now(),
          updatedAt: now(),
          messages: [],
        };
      }

      const history = conv.messages
        .filter((m) => m.status === "complete" || m.status === "partial")
        .reverse()
        .map((m) => ({ role: m.role, content: m.content }));

      const userMsg: Message = {
        id: newId(),
        conversationId,
        role: "user",
        content: text,
        status: "complete",
        createdAt: now(),
        completedAt: now(),
      };
      const assistantMsg: Message = {
        id: newId(),
        conversationId,
        role: "assistant",
        content: "",
        status: "generating",
        createdAt: now(),
        completedAt: null,
      };
      conv.messages.push(userMsg, assistantMsg);
      conv.updatedAt = now();
      persist(conv);

      streamAssistant(conv, assistantMsg, history, text);
      return { messageId: assistantMsg.id };
    },
    "chat.regenerate": ({ messageId }: { messageId: string }) => {
      if (deps.engine.isGenerating()) {
        fail("ENGINE_BUSY", "a generation is already in progress");
      }
      if (deps.engine.status().status !== "ready") {
        fail("NO_MODEL", "no model is loaded");
      }
      const found = findMessage(messageId);
      const { conv, msg } = found ?? { conv: null, msg: null };
      if (!conv || !msg || msg.role !== "assistant" || conv.messages.at(-1) !== msg) {
        fail("NOT_FOUND", `assistant turn ${messageId} not found`);
      }
      const userMsg = conv.messages[conv.messages.indexOf(msg) - 1];
      if (!userMsg || userMsg.role !== "user") {
        fail("NOT_FOUND", "preceding user turn not found");
      }
      const history = turnsBefore(conv, userMsg.id);
      msg.content = "";
      msg.status = "generating";
      msg.completedAt = null;
      msg.stats = null;
      conv.updatedAt = now();
      persist(conv);
      streamAssistant(conv, msg, history, userMsg.content);
      return { messageId };
    },
    "chat.edit": ({
      messageId,
      content,
    }: {
      messageId: string;
      content: string;
    }) => {
      const text = content.trim();
      if (!text) fail("EMPTY_MESSAGE", "message must not be empty");
      if (deps.engine.isGenerating()) {
        fail("ENGINE_BUSY", "a generation is already in progress");
      }
      if (deps.engine.status().status !== "ready") {
        fail("NO_MODEL", "no model is loaded");
      }
      const found = findMessage(messageId);
      const { conv, msg } = found ?? { conv: null, msg: null };
      if (!conv || !msg || msg.role !== "user") {
        fail("NOT_FOUND", `user turn ${messageId} not found`);
      }
      const history = turnsBefore(conv, messageId);
      msg.content = text;
      // delete every turn after the edited message (FR-007)
      conv.messages.splice(conv.messages.indexOf(msg) + 1);
      const assistantMsg: Message = {
        id: newId(),
        conversationId: conv.id,
        role: "assistant",
        content: "",
        status: "generating",
        createdAt: now(),
        completedAt: null,
      };
      conv.messages.push(assistantMsg);
      conv.updatedAt = now();
      persist(conv);
      streamAssistant(conv, assistantMsg, history, text);
      return { messageId: assistantMsg.id };
    },
    "chat.stop": ({ messageId }: { messageId: string }) => {
      if (!deps.engine.isGenerating() || activeMessageId !== messageId) {
        fail("NOT_GENERATING", "no generation is active for that message");
      }
      deps.engine.stop();
      return {};
    },
    "settings.get": () => {
      const s = deps.store.getSettings();
      return { generation: s.generation, modelOverrides: s.modelOverrides };
    },
    "settings.set": ({
      generation,
      modelOverride,
    }: {
      generation?: Partial<GenerationParams>;
      modelOverride?: {
        fileName: string;
        params: Partial<GenerationParams> | null;
      };
    }) => {
      const err =
        (generation ? validateParams(generation) : null) ??
        (modelOverride?.params ? validateParams(modelOverride.params) : null);
      if (err) fail("INVALID_PARAMS", err);
      const s = deps.store.getSettings();
      const next = { ...s, modelOverrides: { ...s.modelOverrides } };
      if (generation) {
        next.generation = mergeParams(s.generation, generation);
      }
      if (modelOverride) {
        if (modelOverride.params === null) {
          delete next.modelOverrides[modelOverride.fileName];
        } else {
          next.modelOverrides[modelOverride.fileName] = {
            ...(next.modelOverrides[modelOverride.fileName] ?? {}),
            ...modelOverride.params,
          };
        }
      }
      deps.store.saveSettings(next);
      return {};
    },
    "model.setOverride": ({
      fileName,
      params,
    }: {
      fileName: string;
      params: Partial<GenerationParams> | null;
    }) => {
      const err = params ? validateParams(params) : null;
      if (err) fail("INVALID_PARAMS", err);
      const s = deps.store.getSettings();
      const next = { ...s, modelOverrides: { ...s.modelOverrides } };
      if (params === null) {
        delete next.modelOverrides[fileName];
      } else {
        next.modelOverrides[fileName] = {
          ...(next.modelOverrides[fileName] ?? {}),
          ...params,
        };
      }
      deps.store.saveSettings(next);
      return {};
    },
    "conversation.list": () => deps.store.listConversations(),
    "conversation.get": ({ conversationId }: { conversationId: string }) => {
      const conv = deps.store.getConversation(conversationId);
      if (!conv) fail("NOT_FOUND", `conversation ${conversationId} not found`);
      return conv;
    },
    "conversation.create": ({ title }: { title?: string }) => {
      const conv: Conversation = {
        id: newId(),
        title: title?.trim() || "New conversation",
        createdAt: now(),
        updatedAt: now(),
        messages: [],
      };
      persist(conv);
      return { id: conv.id, title: conv.title, updatedAt: conv.updatedAt };
    },
    "conversation.rename": ({
      conversationId,
      title,
    }: {
      conversationId: string;
      title: string;
    }) => {
      const conv = deps.store.getConversation(conversationId);
      if (!conv) fail("NOT_FOUND", `conversation ${conversationId} not found`);
      const t = title.trim();
      if (!t) fail("EMPTY_TITLE", "title must not be empty");
      conv.title = t;
      conv.updatedAt = now();
      persist(conv);
      return {};
    },
    "conversation.delete": ({ conversationId }: { conversationId: string }) => {
      if (!deps.store.deleteConversation(conversationId)) {
        fail("NOT_FOUND", `conversation ${conversationId} not found`);
      }
      return {};
    },
  };
}

export type RequestHandlers = ReturnType<typeof createRequestHandlers>;

const engine = new LlamaEngine();

// Attempts initial model load from settings.activeModelPath or MODEL_PATH
// (MVP bootstrap before US3's model picker).
async function bootstrapModel(emit: Emit): Promise<void> {
  const path = store.getSettings().activeModelPath ?? process.env.MODEL_PATH;
  if (!path) return;
  emit("model.progress", { phase: "loading" });
  try {
    const res = await engine.loadModel(path);
    emit("model.progress", { phase: "ready", detail: res.name });
  } catch (e) {
    emit("model.progress", {
      phase: "error",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

export function createRpc() {
  let emit: Emit = () => {};
  const handlers = createRequestHandlers({
    engine,
    emit: (m, p) => emit(m, p),
    store,
  });
  const rpc = defineElectrobunRPC<ChatRpcSchema, "bun">("bun", {
    handlers: { requests: handlers, messages: {} },
  });
  emit = (m, p) => {
    try {
      (rpc.send as CallableFunction)(m, p);
    } catch {
      // transport not attached yet — pre-window emits are dropped;
      // the renderer reconciles via model.status on mount
    }
  };
  // bootstrap must run after a BrowserWindow attaches the rpc transport
  const start = () => void bootstrapModel(emit);
  return { rpc, start };
}

export { engine };
