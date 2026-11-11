import type { ElectrobunRPCSchema } from "electrobun/main/rpc";
import type {
  BenchmarkRecord,
  Conversation,
  ConversationMode,
  ConversationSummary,
  DownloadState,
  FusionAdvise,
  FusionPhase,
  GenerationParams,
  ModelAdvise,
  ModelMeta,
  ModelTag,
  ResolvedRole,
  RoleRef,
  RoleView,
  TurnStats,
  ModelStatus,
} from "./types";

export const RPC_ERROR_CODES = [
  "MODEL_NOT_FOUND",
  "MODEL_INVALID",
  "OUT_OF_MEMORY",
  "ENGINE_ERROR",
  "NO_MODEL",
  "ENGINE_BUSY",
  "EMPTY_MESSAGE",
  "NOT_GENERATING",
  "NOT_FOUND",
  "EMPTY_TITLE",
  "INVALID_PARAMS",
  "INVALID_URL",
  "DOWNLOAD_FAILED",
  "ALREADY_EXISTS",
  "ROLE_UNBOUND",
  "ROLE_IN_USE",
] as const;

export type RpcErrorCode = (typeof RPC_ERROR_CODES)[number];

export interface RpcError {
  code: RpcErrorCode;
  message: string;
}

// Schema per contracts/rpc.md. In ElectrobunRPCSchema, each side declares the
// requests it *handles* and the messages it *receives*.
export interface ChatRpcSchema extends ElectrobunRPCSchema {
  bun: {
    requests: {
      "model.load": {
        params: { path: string };
        response: { status: "ready"; name: string };
      };
      "model.unload": { params: Record<string, never>; response: Record<string, never> };
      "model.pick": {
        params: Record<string, never>;
        response: { path: string | null };
      };
      "model.status": {
        params: Record<string, never>;
        response: { status: ModelStatus; name?: string; error?: string };
      };
      "chat.send": {
        params: {
          conversationId: string;
          content: string;
          // client-assigned id for the stored user message, so optimistic
          // renderer messages keep backend-visible ids (needed by chat.edit)
          userMessageId?: string;
          // fusion mode applied only when this send creates the conversation
          // (existing conversations use conversation.setMode)
          mode?: ConversationMode;
          plannerTag?: string;
          executorTag?: string;
          // feature 009: ids from attachment.pick, resolved + injected
          // main-side; unknown id -> INVALID_PARAMS
          attachmentIds?: string[];
        };
        response: { messageId: string };
      };
      "chat.regenerate": {
        params: { messageId: string };
        response: { messageId: string };
      };
      "chat.edit": {
        params: {
          messageId: string;
          content: string;
          // client-assigned id for the new user variant (same pattern as
          // chat.send's userMessageId) so optimistic state matches the store
          userMessageId?: string;
        };
        response: { messageId: string };
      };
      "chat.stop": { params: { messageId: string }; response: Record<string, never> };
      // feature 005: pure navigation — sets activeLeaf = deepestLeaf(target)
      "message.selectVariant": {
        params: { messageId: string };
        response: { activeLeaf: string };
      };
      "settings.get": {
        params: Record<string, never>;
        response: {
          generation: GenerationParams;
          modelOverrides: Record<string, Partial<GenerationParams>>;
        };
      };
      "settings.set": {
        params: {
          generation?: Partial<GenerationParams>;
          modelOverride?: {
            fileName: string;
            params: Partial<GenerationParams> | null;
          };
        };
        response: Record<string, never>;
      };
      "model.list": {
        params: Record<string, never>;
        response: { models: ModelMeta[] };
      };
      // feature 011: bounded benchmark — ENGINE_BUSY while generating or
      // a benchmark is already running; swaps + restores the active model
      "model.benchmark": {
        params: { path: string };
        response: { record: BenchmarkRecord };
      };
      // feature 011: live verdicts — never loads a model; basis is
      // "measured" when a fingerprinted benchmark exists else "estimated"
      "model.advise": {
        params: { plannerTag?: string; executorTag?: string };
        response: { models: ModelAdvise[]; fusion?: FusionAdvise };
      };
      "model.download": {
        // tagName: bind the finished file to this tag (feature 004)
        params: { url: string; fileName: string; tagName?: string };
        response: { fileName: string };
      };
      "model.setOverride": {
        params: {
          fileName: string;
          params: Partial<GenerationParams> | null;
        };
        response: Record<string, never>;
      };
      "conversation.list": {
        params: Record<string, never>;
        response: ConversationSummary[];
      };
      "conversation.get": {
        params: { conversationId: string };
        response: Conversation;
      };
      "conversation.create": {
        params: { title?: string };
        response: ConversationSummary;
      };
      "conversation.rename": {
        params: { conversationId: string; title: string };
        response: Record<string, never>;
      };
      "conversation.delete": {
        params: { conversationId: string };
        response: Record<string, never>;
      };
      // feature 008: export/import. path null = user cancelled the picker
      "conversation.export": {
        params: { conversationId: string; format: "markdown" | "json" };
        response: { path: string | null };
      };
      "conversation.import": {
        params: Record<string, never>;
        response: { conversationId: string | null };
      };
      "backup.export": {
        params: Record<string, never>;
        response: { path: string | null };
      };
      "backup.import": {
        params: Record<string, never>;
        response: { imported: number | null };
      };
      // feature 009: multi-select picker; content stays main-side.
      // null = cancelled; rejected carries per-file reasons (binary/oversized)
      "attachment.pick": {
        params: Record<string, never>;
        response: {
          picked: Array<{
            id: string;
            path: string;
            fileName: string;
            sizeBytes: number;
          }>;
          rejected: Array<{ fileName: string; reason: string }>;
        } | null;
      };
      "conversation.setMode": {
        params: {
          conversationId: string;
          mode: ConversationMode;
          plannerTag?: string;
          executorTag?: string;
        };
        response: Record<string, never>;
      };
      "role.list": {
        params: Record<string, never>;
        response: { tags: RoleView[] };
      };
      "role.create": {
        params: { name: string; label?: string; description?: string };
        response: { tag: ModelTag };
      };
      "role.update": {
        params: {
          name: string;
          label?: string;
          description?: string;
          params?: Partial<GenerationParams> | null;
        };
        response: Record<string, never>;
      };
      "role.delete": {
        params: { name: string; force?: boolean };
        response: Record<string, never>;
      };
      "role.bind": {
        params: { name: string; fileName: string | null };
        response: Record<string, never>;
      };
      "role.setFallback": {
        params: { name: string; chain: RoleRef[] };
        response: Record<string, never>;
      };
      "role.resolve": {
        params: { name: string };
        response: { resolved: ResolvedRole; candidates: ResolvedRole[] };
      };
    };
    messages: Record<string, never>;
  };
  webview: {
    requests: Record<string, never>;
    messages: {
      "chat.token": { messageId: string; delta: string; phase?: FusionPhase };
      "chat.phase": {
        messageId: string;
        phase: FusionPhase;
        tag: string;
        fileName: string;
        servedBy: "primary" | "fallback";
      };
      "chat.done": {
        messageId: string;
        status: "complete" | "partial";
        stats?: TurnStats;
      };
      "role.changed": { name: string };
      "chat.error": { messageId: string; code: RpcErrorCode; message: string };
      "model.progress": {
        phase: "loading" | "ready" | "error";
        detail?: string;
      };
      "model.download": DownloadState;
      "chat.warning": {
        messageId: string;
        code: "CONTEXT_TRUNCATED" | "ATTACHMENTS_BUDGET";
        message: string;
      };
    };
  };
}
