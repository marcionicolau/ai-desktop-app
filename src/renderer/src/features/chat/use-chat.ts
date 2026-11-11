// Chat state: stream reducer accumulating chat.token deltas, conversation
// list + switching, model status tracking.
import { useCallback, useEffect, useReducer, useRef } from "react";
import type {
  ConversationSummary,
  Message,
  ModelStatus,
} from "@shared/types";
import type { RpcErrorCode } from "@shared/rpc-contract";
import { invoke, on } from "@/lib/rpc";

interface ChatState {
  conversations: ConversationSummary[];
  conversationId: string | null;
  messages: Message[];
  generatingId: string | null;
  modelStatus: ModelStatus;
  modelError: string | null;
  lastError: { code: RpcErrorCode; message: string } | null;
}

type Action =
  | { type: "list"; conversations: ConversationSummary[] }
  | { type: "hydrate"; conversationId: string | null; messages: Message[] }
  | { type: "append"; message: Message }
  | { type: "token"; messageId: string; delta: string }
  | { type: "done"; messageId: string; status: "complete" | "partial" }
  | { type: "error"; messageId: string; code: RpcErrorCode; message: string }
  | { type: "model"; status: ModelStatus; error?: string };

function reduce(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case "list":
      return { ...state, conversations: action.conversations };
    case "hydrate":
      return {
        ...state,
        conversationId: action.conversationId,
        messages: action.messages,
        generatingId: null,
      };
    case "append":
      return {
        ...state,
        messages: [...state.messages, action.message],
        generatingId:
          action.message.status === "generating"
            ? action.message.id
            : state.generatingId,
      };
    case "token":
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.messageId
            ? { ...m, content: m.content + action.delta }
            : m,
        ),
      };
    case "done":
      return {
        ...state,
        generatingId: null,
        messages: state.messages.map((m) =>
          m.id === action.messageId
            ? {
                ...m,
                status: action.status,
                completedAt: new Date().toISOString(),
              }
            : m,
        ),
      };
    case "error":
      return {
        ...state,
        generatingId: null,
        lastError: { code: action.code, message: action.message },
        messages: state.messages.map((m) =>
          m.id === action.messageId ? { ...m, status: "failed" } : m,
        ),
      };
    case "model":
      return {
        ...state,
        modelStatus: action.status,
        modelError: action.error ?? null,
      };
  }
}

const initial: ChatState = {
  conversations: [],
  conversationId: null,
  messages: [],
  generatingId: null,
  modelStatus: "unloaded",
  modelError: null,
  lastError: null,
};

export function useChat() {
  const [state, dispatch] = useReducer(reduce, initial);
  const convRef = useRef<string | null>(null);

  const refreshList = useCallback(async () => {
    try {
      const conversations = await invoke("conversation.list", {});
      dispatch({ type: "list", conversations });
    } catch {
      // list is best-effort; keep current state
    }
  }, []);

  const selectConversation = useCallback(async (id: string) => {
    const conv = await invoke("conversation.get", { conversationId: id });
    convRef.current = conv.id;
    dispatch({ type: "hydrate", conversationId: conv.id, messages: conv.messages });
  }, []);

  const newConversation = useCallback(() => {
    convRef.current = null; // draft: created on first send (T032)
    dispatch({ type: "hydrate", conversationId: null, messages: [] });
  }, []);

  const renameConversation = useCallback(
    async (id: string, title: string) => {
      await invoke("conversation.rename", { conversationId: id, title });
      await refreshList();
    },
    [refreshList],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      await invoke("conversation.delete", { conversationId: id });
      await refreshList();
      if (convRef.current === id) newConversation();
    },
    [refreshList, newConversation],
  );

  // bootstrap: restore latest conversation + model status, subscribe to events
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await invoke("conversation.list", {});
        if (cancelled) return;
        dispatch({ type: "list", conversations: list });
        const latest = list[0];
        if (latest) {
          const conv = await invoke("conversation.get", {
            conversationId: latest.id,
          });
          if (!cancelled) {
            convRef.current = conv.id;
            dispatch({
              type: "hydrate",
              conversationId: conv.id,
              messages: conv.messages,
            });
          }
        }
        const status = await invoke("model.status", {});
        if (!cancelled) {
          dispatch({ type: "model", status: status.status, error: status.error });
        }
      } catch (e) {
        if (!cancelled) {
          dispatch({
            type: "error",
            messageId: "",
            code: "ENGINE_ERROR",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();

    const unsubs = [
      on("chat.token", (p) =>
        dispatch({ type: "token", messageId: p.messageId, delta: p.delta }),
      ),
      on("chat.done", (p) => {
        dispatch({ type: "done", messageId: p.messageId, status: p.status });
        void refreshList(); // new/updated conversation appears in sidebar
      }),
      on("chat.error", (p) =>
        dispatch({
          type: "error",
          messageId: p.messageId,
          code: p.code,
          message: p.message,
        }),
      ),
      on("model.progress", (p) =>
        dispatch({
          type: "model",
          status:
            p.phase === "ready" ? "ready" : p.phase === "error" ? "error" : "loading",
          error: p.detail,
        }),
      ),
    ];
    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [refreshList]);

  const send = useCallback(
    async (content: string) => {
      convRef.current ??= crypto.randomUUID();
      const conversationId = convRef.current;
      const now = new Date().toISOString();
      dispatch({
        type: "hydrate",
        conversationId,
        messages: state.messages,
      });
      dispatch({
        type: "append",
        message: {
          id: crypto.randomUUID(),
          conversationId,
          role: "user",
          content,
          status: "complete",
          createdAt: now,
          completedAt: now,
        },
      });
      const { messageId } = await invoke("chat.send", {
        conversationId,
        content,
      });
      dispatch({
        type: "append",
        message: {
          id: messageId,
          conversationId,
          role: "assistant",
          content: "",
          status: "generating",
          createdAt: now,
          completedAt: null,
        },
      });
    },
    [state.messages],
  );

  const stop = useCallback(() => {
    if (state.generatingId) {
      void invoke("chat.stop", { messageId: state.generatingId });
    }
  }, [state.generatingId]);

  const loadModel = useCallback(async (path: string) => {
    await invoke("model.load", { path });
  }, []);

  return {
    state,
    send,
    stop,
    loadModel,
    selectConversation,
    newConversation,
    renameConversation,
    deleteConversation,
  };
}
