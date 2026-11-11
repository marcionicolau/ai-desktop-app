// RPC handlers for the chat schema (contracts/rpc.md).
// createRequestHandlers is dependency-injected so tests/rpc can exercise the
// contract without the Electrobun bridge or a real model.
import { defineElectrobunRPC } from "electrobun/main/rpc";
import type { ChatRpcSchema, RpcErrorCode } from "../../shared/rpc-contract";
import type { Conversation, Message, ModelStatus } from "../../shared/types";
import { EngineError, LlamaEngine } from "../llama/engine";
import * as store from "../store/json-store";

type Events = ChatRpcSchema["webview"]["messages"];
type Emit = <M extends keyof Events>(method: M, payload: Events[M]) => void;

export interface EngineLike {
  status(): { status: ModelStatus; name?: string; error?: string };
  loadModel(path: string): Promise<{ status: "ready"; name: string }>;
  unloadModel(): void;
  isGenerating(): boolean;
  generate(
    prompt: string,
    onToken: (delta: string) => void,
  ): Promise<"complete" | "partial">;
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

      void deps.engine
        .generate(text, (delta) => {
          assistantMsg.content += delta;
          dirty = true;
          deps.emit("chat.token", { messageId, delta });
        })
        .then((status) => {
          assistantMsg.status = status;
          assistantMsg.completedAt = now();
          persist(conv);
          deps.emit("chat.done", { messageId, status });
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

      return { messageId };
    },
    "chat.stop": ({ messageId }: { messageId: string }) => {
      if (!deps.engine.isGenerating() || activeMessageId !== messageId) {
        fail("NOT_GENERATING", "no generation is active for that message");
      }
      deps.engine.stop();
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
  emit = (m, p) => (rpc.send as CallableFunction)(m, p);
  void bootstrapModel(emit);
  return rpc;
}

export { engine };
