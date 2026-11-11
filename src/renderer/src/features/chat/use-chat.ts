// Chat state: stream reducer accumulating chat.token deltas, conversation
// list + switching, model status tracking.
import { useCallback, useEffect, useReducer, useRef } from "react";
import type {
  ConversationSummary,
  FusionPhase,
  GenerationParams,
  Message,
  MessageAttachment,
  ModelStatus,
} from "@shared/types";
import { DEFAULT_GENERATION } from "@shared/types";
import type { RpcErrorCode } from "@shared/rpc-contract";
import { invoke, on } from "@/lib/rpc";
import {
  branchPoints,
  deepestLeaf,
  leafOf,
  pathOf,
  variantInfo,
} from "./tree";

interface ChatState {
  conversations: ConversationSummary[];
  conversationId: string | null;
  // flat append-only store incl. hidden variants (feature 005)
  messages: Message[];
  // deepest message on the displayed branch; null = last in array
  activeLeaf: string | null;
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
  // feature 006: persona assigned to the open conversation (null = none)
  personaName: string | null;
  activePhase: {
    phase: FusionPhase;
    tag: string;
    fileName: string;
    servedBy?: "primary" | "fallback";
  } | null;
}

type Action =
  | { type: "list"; conversations: ConversationSummary[] }
  | {
      type: "hydrate";
      conversationId: string | null;
      messages: Message[];
      activeLeaf: string | null;
      personaName?: string | null;
    }
  | { type: "selectVariant"; activeLeaf: string }
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
  | { type: "persona"; name: string | null }
  | { type: "error"; messageId: string; code: RpcErrorCode; message: string }
  | { type: "model"; status: ModelStatus; name?: string; error?: string }
  | { type: "notice"; message: string }
  | { type: "generation"; params: GenerationParams }
  | {
      type: "editApplied";
      userVariantId: string;
      content: string;
      parentId: string | null;
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
        activeLeaf: action.activeLeaf,
        generatingId: null,
        activePhase: null,
        personaName:
          action.personaName !== undefined
            ? action.personaName
            : state.personaName,
      };
    case "persona":
      return { ...state, personaName: action.name };
    case "selectVariant":
      return { ...state, activeLeaf: action.activeLeaf };
    case "append":
      // every appended message becomes the active leaf (feature 005)
      return {
        ...state,
        messages: [...state.messages, action.message],
        activeLeaf: action.message.id,
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
    case "editApplied": {
      // feature 005: append a user variant + fresh assistant child;
      // the original subtree stays in the flat list
      const now = new Date().toISOString();
      return {
        ...state,
        generatingId: action.assistantId,
        activeLeaf: action.assistantId,
        lastError: null,
        messages: [
          ...state.messages,
          {
            id: action.userVariantId,
            conversationId: action.conversationId,
            role: "user",
            content: action.content,
            status: "complete",
            createdAt: now,
            completedAt: now,
            parentId: action.parentId,
          },
          {
            id: action.assistantId,
            conversationId: action.conversationId,
            role: "assistant",
            content: "",
            status: "generating",
            createdAt: now,
            completedAt: null,
            parentId: action.userVariantId,
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
  activeLeaf: null,
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
  personaName: null,
  activePhase: null,
};

export function useChat() {
  const [state, dispatch] = useReducer(reduce, initial);
  const convRef = useRef<string | null>(null);
  // persona picked on a draft conversation, applied once chat.send creates it
  const pendingPersona = useRef<string | null>(null);

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
      activeLeaf: conv.activeLeaf ?? conv.messages.at(-1)?.id ?? null,
      personaName: conv.personaName ?? null,
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
    dispatch({
      type: "hydrate",
      conversationId: null,
      messages: [],
      activeLeaf: null,
      personaName: null,
    });
  }, []);

  // feature 006: assign/clear the conversation's persona. Drafts have no
  // server record yet — the pick is stashed and applied on first send.
  // Returns the RPC response ({suggestedTag}) so the caller can offer a
  // preferred-tag re-bind (never automatic).
  const setPersona = useCallback(
    async (name: string | null) => {
      pendingPersona.current = name;
      dispatch({ type: "persona", name });
      if (!convRef.current) return {};
      const r = await invoke("conversation.setPersona", {
        conversationId: convRef.current,
        personaName: name,
      });
      void refreshList(); // sidebar badge updates
      return r;
    },
    [refreshList],
  );

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

  // feature 008: returns the written path, or null when the picker cancelled
  const exportConversation = useCallback(
    async (id: string, format: "markdown" | "json") => {
      const r = await invoke("conversation.export", {
        conversationId: id,
        format,
      });
      return r.path;
    },
    [],
  );

  const importConversation = useCallback(async () => {
    const r = await invoke("conversation.import", {});
    await refreshList();
    if (r.conversationId) await selectConversation(r.conversationId);
    return r.conversationId;
  }, [refreshList, selectConversation]);

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
              activeLeaf: conv.activeLeaf ?? conv.messages.at(-1)?.id ?? null,
              personaName: conv.personaName ?? null,
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
    async (
      content: string,
      attachmentIds: string[] = [],
      attachmentChips: MessageAttachment[] = [],
    ) => {
      convRef.current ??= crypto.randomUUID();
      const conversationId = convRef.current;
      const now = new Date().toISOString();
      const userMessageId = crypto.randomUUID();
      // chain onto the displayed leaf so new turns continue the active
      // branch, not a dead variant (feature 005)
      const parent = leafOf(state.messages, state.activeLeaf);
      dispatch({
        type: "hydrate",
        conversationId,
        messages: state.messages,
        activeLeaf: state.activeLeaf,
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
          parentId: parent?.id ?? null,
          attachments: attachmentChips.length ? attachmentChips : null,
        },
      });
      const { messageId } = await invoke("chat.send", {
        conversationId,
        content,
        userMessageId,
        mode: state.mode,
        plannerTag: state.plannerTag,
        executorTag: state.executorTag,
        attachmentIds: attachmentIds.length ? attachmentIds : undefined,
      });
      // feature 006: apply a persona picked on the draft now that the
      // conversation exists server-side
      if (pendingPersona.current) {
        void invoke("conversation.setPersona", {
          conversationId,
          personaName: pendingPersona.current,
        });
        pendingPersona.current = null;
      }
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
          parentId: userMessageId,
        },
      });
    },
    [
      state.messages,
      state.activeLeaf,
      state.mode,
      state.plannerTag,
      state.executorTag,
    ],
  );

  const stop = useCallback(() => {
    if (state.generatingId) {
      void invoke("chat.stop", { messageId: state.generatingId });
    }
  }, [state.generatingId]);

  const regenerate = useCallback(
    async (messageId: string) => {
      if (!convRef.current) return;
      const target = state.messages.find((m) => m.id === messageId);
      try {
        // feature 005: the backend appends a sibling variant; mirror it
        const { messageId: variantId } = await invoke("chat.regenerate", {
          messageId,
        });
        dispatch({
          type: "append",
          message: {
            id: variantId,
            conversationId: convRef.current,
            role: "assistant",
            content: "",
            status: "generating",
            createdAt: new Date().toISOString(),
            completedAt: null,
            parentId: target?.parentId ?? null,
          },
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

  const editMessage = useCallback(
    async (messageId: string, content: string) => {
      if (!convRef.current) return;
      const target = state.messages.find((m) => m.id === messageId);
      const userMessageId = crypto.randomUUID();
      try {
        const { messageId: assistantId } = await invoke("chat.edit", {
          messageId,
          content,
          userMessageId,
        });
        dispatch({
          type: "editApplied",
          userVariantId: userMessageId,
          content,
          parentId: target?.parentId ?? null,
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

  // feature 005: navigate to a variant — updates the leaf locally (fast
  // path) then persists via message.selectVariant; on failure reconcile
  // from the store
  const selectVariant = useCallback(
    (messageId: string) => {
      if (state.generatingId) return; // FR-006: no switching mid-turn
      const target = state.messages.find((m) => m.id === messageId);
      if (!target) return;
      const leaf = deepestLeaf(state.messages, target);
      dispatch({ type: "selectVariant", activeLeaf: leaf.id });
      void invoke("message.selectVariant", { messageId }).catch(async () => {
        if (!convRef.current) return;
        try {
          const conv = await invoke("conversation.get", {
            conversationId: convRef.current,
          });
          dispatch({
            type: "hydrate",
            conversationId: conv.id,
            messages: conv.messages,
            activeLeaf: conv.activeLeaf ?? null,
          });
        } catch {
          // keep local state
        }
      });
    },
    [state.generatingId, state.messages],
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

  // derived views for the UI: displayed path + variant/branch metadata
  const path = pathOf(state.messages, state.activeLeaf);
  const variants = variantInfo(state.messages);
  const branches = branchPoints(state.messages);

  return {
    state,
    path,
    variants,
    branches,
    send,
    stop,
    loadModel,
    pickModel,
    saveGeneration,
    selectConversation,
    newConversation,
    renameConversation,
    deleteConversation,
    exportConversation,
    importConversation,
    regenerate,
    editMessage,
    setMode,
    setPersona,
    selectVariant,
  };
}
