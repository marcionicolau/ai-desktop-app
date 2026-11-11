// Chat state: stream reducer accumulating chat.token deltas, conversation
// list + switching, model status tracking.
import { useCallback, useEffect, useReducer, useRef } from "react";
import type {
  ConversationSummary,
  FusionPhase,
  GenerationParams,
  Message,
  ModelStatus,
} from "@shared/types";
import { DEFAULT_GENERATION } from "@shared/types";
import type { RpcErrorCode } from "@shared/rpc-contract";
import { invoke, on } from "@/lib/rpc";

interface ChatState {
  conversations: ConversationSummary[];
  conversationId: string | null;
  messages: Message[];
  generatingId: string | null;
  modelStatus: ModelStatus;
  modelName: string | null;
  modelError: string | null;
  lastError: { code: RpcErrorCode; message: string } | null;
  notice: string | null;
  generation: GenerationParams;
  mode: "single" | "fusion";
  plannerTag: string;
  executorTag: string;
  activePhase: {
    phase: FusionPhase;
    tag: string;
    fileName: string;
    servedBy?: "primary" | "fallback";
  } | null;
}

type Action =
  | { type: "list"; conversations: ConversationSummary[] }
  | { type: "hydrate"; conversationId: string | null; messages: Message[] }
  | { type: "append"; message: Message }
  | { type: "token"; messageId: string; delta: string; phase?: FusionPhase }
  | {
      type: "phase";
      messageId: string;
      phase: FusionPhase;
      tag: string;
      fileName: string;
      servedBy?: "primary" | "fallback";
    }
  | {
      type: "done";
      messageId: string;
      status: "complete" | "partial";
      stats?: Message["stats"];
      phases?: Message["phases"];
    }
  | {
      type: "mode";
      mode: "single" | "fusion";
      plannerTag: string;
      executorTag: string;
    }
  | { type: "error"; messageId: string; code: RpcErrorCode; message: string }
  | { type: "model"; status: ModelStatus; name?: string; error?: string }
  | { type: "notice"; message: string }
  | { type: "generation"; params: GenerationParams }
  | { type: "reset"; messageId: string }
  | {
      type: "editApplied";
      messageId: string;
      content: string;
      assistantId: string;
      conversationId: string;
    };

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
        activePhase: null,
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
        messages: state.messages.map((m) => {
          if (m.id !== action.messageId) return m;
          if (action.phase === "plan") {
            // plan-phase tokens accumulate on phases.plan, not the answer body
            const plan = {
              content: "",
              tag: "",
              fileName: "",
              ...m.phases?.plan,
            };
            return {
              ...m,
              phases: {
                ...m.phases,
                plan: { ...plan, content: plan.content + action.delta },
              },
            };
          }
          return { ...m, content: m.content + action.delta };
        }),
      };
    case "phase":
      return {
        ...state,
        activePhase: {
          phase: action.phase,
          tag: action.tag,
          fileName: action.fileName,
          servedBy: action.servedBy,
        },
        messages: state.messages.map((m) => {
          if (m.id !== action.messageId) return m;
          const phases = { ...m.phases };
          if (action.phase === "plan") {
            phases.plan = {
              content: "",
              stats: null,
              ...phases.plan,
              tag: action.tag,
              fileName: action.fileName,
              servedBy: action.servedBy,
            };
          } else {
            phases.answer = {
              ...phases.answer,
              tag: action.tag,
              fileName: action.fileName,
              servedBy: action.servedBy,
            };
          }
          return { ...m, phases };
        }),
      };
    case "mode":
      return {
        ...state,
        mode: action.mode,
        plannerTag: action.plannerTag,
        executorTag: action.executorTag,
      };
    case "done":
      return {
        ...state,
        generatingId: null,
        activePhase: null,
        messages: state.messages.map((m) => {
          if (m.id !== action.messageId) return m;
          // merge per-phase stats onto phases accumulated by token/phase events
          const phases = action.phases
            ? {
                ...m.phases,
                ...(m.phases?.plan
                  ? {
                      plan: { ...m.phases.plan, stats: action.phases.plan?.stats },
                    }
                  : {}),
                ...(m.phases?.answer || action.phases.answer
                  ? {
                      answer: {
                        ...m.phases?.answer,
                        stats: action.phases.answer?.stats,
                      },
                    }
                  : {}),
              }
            : m.phases;
          return {
            ...m,
            status: action.status,
            completedAt: new Date().toISOString(),
            stats: action.stats ?? m.stats,
            phases,
          };
        }),
      };
    case "error":
      return {
        ...state,
        generatingId: null,
        activePhase: null,
        lastError: { code: action.code, message: action.message },
        messages: state.messages.map((m) =>
          m.id === action.messageId ? { ...m, status: "failed" } : m,
        ),
      };
    case "model":
      return {
        ...state,
        modelStatus: action.status,
        modelName: action.name ?? state.modelName,
        modelError: action.error ?? null,
      };
    case "notice":
      return { ...state, notice: action.message };
    case "generation":
      return { ...state, generation: action.params };
    case "reset":
      return {
        ...state,
        generatingId: action.messageId,
        lastError: null,
        messages: state.messages.map((m) =>
          m.id === action.messageId
            ? {
                ...m,
                content: "",
                status: "generating",
                completedAt: null,
                stats: null,
                phases: null,
              }
            : m,
        ),
      };
    case "editApplied": {
      const idx = state.messages.findIndex((m) => m.id === action.messageId);
      if (idx === -1) return state;
      const kept = state.messages.slice(0, idx);
      kept.push({ ...state.messages[idx]!, content: action.content });
      return {
        ...state,
        generatingId: action.assistantId,
        lastError: null,
        messages: [
          ...kept,
          {
            id: action.assistantId,
            conversationId: action.conversationId,
            role: "assistant",
            content: "",
            status: "generating",
            createdAt: new Date().toISOString(),
            completedAt: null,
          },
        ],
      };
    }
  }
}

const initial: ChatState = {
  conversations: [],
  conversationId: null,
  messages: [],
  generatingId: null,
  modelStatus: "unloaded",
  modelName: null,
  modelError: null,
  lastError: null,
  notice: null,
  generation: DEFAULT_GENERATION,
  mode: "single",
  plannerTag: "planner",
  executorTag: "executor",
  activePhase: null,
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
    dispatch({
      type: "hydrate",
      conversationId: conv.id,
      messages: conv.messages,
    });
    dispatch({
      type: "mode",
      mode: conv.mode ?? "single",
      plannerTag: conv.plannerTag ?? "planner",
      executorTag: conv.executorTag ?? "executor",
    });
  }, []);

  const newConversation = useCallback(() => {
    convRef.current = null; // draft: created on first send (T032)
    dispatch({ type: "hydrate", conversationId: null, messages: [] });
  }, []);

  const setMode = useCallback(
    async (mode: "single" | "fusion", plannerTag: string, executorTag: string) => {
      if (convRef.current) {
        await invoke("conversation.setMode", {
          conversationId: convRef.current,
          mode,
          plannerTag,
          executorTag,
        });
      }
      // drafts (no id yet): mode travels with chat.send on creation
      dispatch({ type: "mode", mode, plannerTag, executorTag });
    },
    [],
  );

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
            dispatch({
              type: "mode",
              mode: conv.mode ?? "single",
              plannerTag: conv.plannerTag ?? "planner",
              executorTag: conv.executorTag ?? "executor",
            });
          }
        }
        const status = await invoke("model.status", {});
        if (!cancelled) {
          dispatch({
            type: "model",
            status: status.status,
            name: status.name,
            error: status.error,
          });
        }
        const s = await invoke("settings.get", {});
        if (!cancelled) {
          dispatch({ type: "generation", params: s.generation });
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
        dispatch({
          type: "token",
          messageId: p.messageId,
          delta: p.delta,
          phase: p.phase,
        }),
      ),
      on("chat.phase", (p) =>
        dispatch({
          type: "phase",
          messageId: p.messageId,
          phase: p.phase,
          tag: p.tag,
          fileName: p.fileName,
          servedBy: p.servedBy,
        }),
      ),
      on("chat.done", (p) => {
        dispatch({
          type: "done",
          messageId: p.messageId,
          status: p.status,
          stats: p.stats?.answer ?? p.stats?.total ?? null,
          phases: p.stats?.plan
            ? {
                // stats merge into phases accumulated by token/phase events
                plan: {
                  content: "",
                  tag: "",
                  fileName: "",
                  stats: p.stats.plan,
                },
                answer: { stats: p.stats.answer ?? null },
              }
            : undefined,
        });
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
      on("chat.warning", (p) =>
        dispatch({ type: "notice", message: p.message }),
      ),
      on("model.progress", (p) =>
        dispatch({
          type: "model",
          status:
            p.phase === "ready" ? "ready" : p.phase === "error" ? "error" : "loading",
          name: p.phase === "ready" ? p.detail : undefined,
          error: p.phase === "error" ? p.detail : undefined,
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
      const userMessageId = crypto.randomUUID();
      dispatch({
        type: "hydrate",
        conversationId,
        messages: state.messages,
      });
      dispatch({
        type: "append",
        message: {
          id: userMessageId,
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
        userMessageId,
        mode: state.mode,
        plannerTag: state.plannerTag,
        executorTag: state.executorTag,
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
    [state.messages, state.mode, state.plannerTag, state.executorTag],
  );

  const stop = useCallback(() => {
    if (state.generatingId) {
      void invoke("chat.stop", { messageId: state.generatingId });
    }
  }, [state.generatingId]);

  const regenerate = useCallback(
    async (messageId: string) => {
      if (!convRef.current) return;
      dispatch({ type: "reset", messageId });
      try {
        await invoke("chat.regenerate", { messageId });
      } catch (e) {
        dispatch({
          type: "error",
          messageId,
          code:
            e && typeof e === "object" && "code" in e
              ? (e.code as RpcErrorCode)
              : "ENGINE_ERROR",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [],
  );

  const editMessage = useCallback(
    async (messageId: string, content: string) => {
      if (!convRef.current) return;
      try {
        const { messageId: assistantId } = await invoke("chat.edit", {
          messageId,
          content,
        });
        dispatch({
          type: "editApplied",
          messageId,
          content,
          assistantId,
          conversationId: convRef.current,
        });
      } catch (e) {
        dispatch({
          type: "error",
          messageId,
          code:
            e && typeof e === "object" && "code" in e
              ? (e.code as RpcErrorCode)
              : "ENGINE_ERROR",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [],
  );

  const loadModel = useCallback(async (path: string) => {
    await invoke("model.load", { path });
  }, []);

  const pickModel = useCallback(async () => {
    const { path } = await invoke("model.pick", {});
    if (path) await invoke("model.load", { path });
  }, []);

  const saveGeneration = useCallback(
    async (patch: Partial<GenerationParams>) => {
      const next = { ...state.generation, ...patch };
      dispatch({ type: "generation", params: next });
      await invoke("settings.set", { generation: patch });
    },
    [state.generation],
  );

  return {
    state,
    send,
    stop,
    loadModel,
    pickModel,
    saveGeneration,
    selectConversation,
    newConversation,
    renameConversation,
    deleteConversation,
    regenerate,
    editMessage,
    setMode,
  };
}
