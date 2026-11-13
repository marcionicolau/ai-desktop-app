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
  InstalledPackView,
  ModelAdvise,
  ModelMeta,
  ModelTag,
  PackContributionsView,
  PackSource,
  ResolvedRole,
  RoleRef,
  RoleView,
  RunRecord,
  RunSummary,
  SearchGroup,
  SetupState,
  SnapshotClearResult,
  SnapshotStats,
  TraceEntry,
  TurnStats,
  MetricEntry,
  ModelStatus,
  Persona,
  Snippet,
  ToolCallRecord,
  ThemeMode,
  ToolPolicy,
  UpdateChannel,
  UpdateView,
  ScriptListItem,
  ScriptPolicy,
  ScriptRunEvent,
  ScriptRunRecord,
  ScriptRuntimeKind,
  ScriptUpsertParams,
  RuntimeStatus,
  SessionStateEvent,
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
  // feature 017: extension packs + fabric runs
  "PACK_INVALID",
  "PACK_INCOMPATIBLE",
  "PACK_NOT_FOUND",
  "CAPABILITY_DENIED",
  "RUN_NOT_FOUND",
  "RUN_ACTIVE",
  "SOURCE_UNREACHABLE",
  "ARCHIVE_INVALID",
  "CONTRIBUTION_NOT_FOUND",
  "CONTRACT_VIOLATION",
  // feature 013: auto-update
  "UPDATE_INVALID",
  "UPDATE_FAILED",
  "UPDATE_DISABLED",
  // feature 023: script calling
  "SCRIPT_NOT_FOUND",
  "SCRIPT_INVALID_ARGS",
  "SCRIPT_TIMEOUT",
  "RUNTIME_NOT_FOUND",
  "SESSION_DEAD",
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
        // ack only — completion arrives via model.progress; a big FFI
        // load must not hold the request open (bridge timeout)
        response: { status: ModelStatus; name?: string; error?: string };
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
          outputPanel: boolean; // feature 016
          tools: ToolPolicy; // feature 015
          scripts?: ScriptPolicy; // feature 023
          themeMode: ThemeMode; // feature 021
          updates: { enabled: boolean; channel: UpdateChannel }; // feature 013
        };
      };
      "settings.set": {
        params: {
          generation?: Partial<GenerationParams>;
          modelOverride?: {
            fileName: string;
            params: Partial<GenerationParams> | null;
          };
          outputPanel?: boolean; // feature 016
          tools?: Partial<ToolPolicy>; // feature 015
          scripts?: Partial<ScriptPolicy>; // feature 023
          themeMode?: ThemeMode; // feature 021
          // transient: resolved color scheme reported by the renderer;
          // not persisted — triggers pushTheme to extension views
          resolvedTheme?: "light" | "dark"; // feature 021
          // feature 013: update preferences
          updates?: { enabled?: boolean; channel?: UpdateChannel };
        };
        response: Record<string, never>;
      };
      // feature 013: check the preferred-channel feed for a newer release;
      // manual surfaces errors, launch-mode degrades silently (FR-007)
      "update.check": {
        params: { manual?: boolean };
        response: UpdateView;
      };
      // feature 013: start the background download; same-channel → native
      // staging, channelSwitch → downloads the installer zip and returns
      // installerPath (contracts/rpc.md)
      "update.download": {
        params: Record<string, never>;
        response: { installerPath?: string };
      };
      // feature 013: apply the staged update via restart; explicit user
      // action only (FR-005)
      "update.apply": {
        params: Record<string, never>;
        response: Record<string, never>;
      };
      // feature 013: snapshot for late-mounting UI
      "update.state": {
        params: Record<string, never>;
        response: UpdateView;
      };
      // feature 015: decision on a pending tool call; NOT_FOUND when the
      // call isn't pending (already decided or discarded)
      "tool.respond": {
        params: {
          callId: string;
          decision: "approve" | "deny" | "allowSession";
        };
        response: Record<string, never>;
      };
      // feature 015: native folder picker for the sandbox root;
      // null = cancelled
      "tool.pickRoot": {
        params: Record<string, never>;
        response: { path: string | null };
      };
      // feature 023: script library + session runtimes. Script calls
      // share tool.respond/tool.update for consent; these cover the
      // library CRUD, manual runs, and runtime health/reset.
      "script.list": {
        params: Record<string, never>;
        response: { scripts: ScriptListItem[] };
      };
      "script.upsert": {
        params: ScriptUpsertParams;
        response: { entry: ScriptListItem };
      };
      "script.delete": {
        params: { id: string };
        response: Record<string, never>;
      };
      "script.enable": {
        params: { id: string; enabled: boolean };
        response: Record<string, never>;
      };
      // manual run — bypasses the consent prompt (user clicked Run) but
      // shares validation/timeout/workdir/capture; progress via the
      // "script.run" event
      "script.run": {
        params: { id: string; args?: Record<string, unknown>; timeoutMs?: number };
        response: ScriptRunRecord;
      };
      "runtime.list": {
        params: Record<string, never>;
        response: { runtimes: RuntimeStatus[] };
      };
      "runtime.detect": {
        params: { kind: ScriptRuntimeKind };
        response: { path: string };
      };
      // kill + clear a runtime session; in-flight call → interrupted
      "runtime.reset": {
        params: { kind: ScriptRuntimeKind };
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
      // feature 022: first-run bootstrap state + manual retry. Both are
      // cheap; the actual work streams via the setup.status event.
      "setup.status": {
        params: Record<string, never>;
        response: SetupState;
      };
      "setup.retry": {
        params: Record<string, never>;
        response: Record<string, never>;
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
      // feature 006: personas + snippets + per-conversation assignment
      "persona.list": {
        params: Record<string, never>;
        response: { personas: Persona[] };
      };
      "persona.upsert": {
        params: { persona: Persona };
        response: { persona: Persona };
      };
      "persona.delete": {
        params: { name: string };
        response: { cleared: number }; // conversations unassigned
      };
      "persona.usage": {
        params: { name: string };
        response: { count: number; titles: string[] };
      };
      "snippet.list": {
        params: Record<string, never>;
        response: { snippets: Snippet[] };
      };
      "snippet.upsert": {
        params: { snippet: Snippet };
        response: { snippet: Snippet };
      };
      "snippet.delete": {
        params: { name: string };
        response: { deleted: boolean };
      };
      "conversation.setPersona": {
        params: { conversationId: string; personaName: string | null };
        response: { suggestedTag?: string };
      };
      // feature 007: literal substring search over all conversations
      "search.query": {
        params: { q: string };
        response: { groups: SearchGroup[] };
      };
      "snapshot.stats": {
        params: Record<string, never>;
        response: SnapshotStats;
      };
      "snapshot.clear": {
        params: Record<string, never>;
        response: SnapshotClearResult;
      };
      // feature 016
      "metrics.list": {
        params: Record<string, never>;
        response: { entries: MetricEntry[] };
      };
      "metrics.clear": {
        params: Record<string, never>;
        response: { removed: number };
      };
      // feature 017: extension packs (contracts/rpc.md)
      "extension.scan": {
        params: Record<string, never>;
        response: { packs: InstalledPackView[] };
      };
      "extension.install": {
        params: { source: PackSource };
        // null = user cancelled the folder/archive picker
        response: { pack: InstalledPackView | null };
      };
      // dry-run: fetch + validate only; powers the consent UI (FR-020)
      "extension.preview": {
        params: { source: PackSource };
        response: { manifest: InstalledPackView["manifest"]; warnings: string[] };
      };
      "extension.enable": {
        // consent required when the pack declares capabilities (FR-005)
        params: { packId: string; consent?: boolean };
        response: { pack: InstalledPackView };
      };
      "extension.disable": {
        params: { packId: string };
        response: { pack: InstalledPackView };
      };
      "extension.remove": {
        params: { packId: string; purgeData?: boolean };
        response: { removed: true };
      };
      "pack.contributions": {
        params: { packId: string };
        response: PackContributionsView;
      };
      "pack.readSpec": {
        params: { contributionId: string };
        response: { frontmatter: Record<string, unknown>; body: string };
      };
      "run.start": {
        params: {
          packId: string;
          target: { kind: "pipeline" | "agent"; id: string };
          objective: string;
          params?: Record<string, unknown>;
          budget?: { maxSteps?: number; maxDelegations?: number; maxModelCalls?: number; maxDepth?: number };
        };
        response: { runId: string };
      };
      "run.cancel": {
        params: { runId: string };
        response: { cancelled: true };
      };
      "run.list": {
        params: { packId?: string; status?: string };
        response: { runs: RunSummary[] };
      };
      "run.get": {
        params: { runId: string };
        response: { run: RunRecord };
      };
      "run.clear": {
        params: { packId: string };
        response: { removed: number };
      };
      "view.open": {
        params: {
          packId: string;
          viewId: string;
          slot?: "tab" | "panel";
          rect?: { x: number; y: number; width: number; height: number };
        };
        response: { sessionId: string };
      };
      "view.close": {
        params: { sessionId: string };
        response: Record<string, never>;
      };
      "view.setBounds": {
        params: { sessionId: string; rect: { x: number; y: number; width: number; height: number } };
        response: Record<string, never>;
      };
      "view.setVisible": {
        params: { sessionId: string; visible: boolean };
        response: Record<string, never>;
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
      // feature 022: pushed on every SetupService phase transition
      "setup.status": SetupState;
      "chat.warning": {
        messageId: string;
        code: "CONTEXT_TRUNCATED" | "ATTACHMENTS_BUDGET" | "TOOL_BUDGET";
        message: string;
      };
      // feature 016: emitted after each recorded call when enabled
      "metrics.entry": MetricEntry;
      // feature 015: full record on every status transition; the
      // renderer keeps a callId-keyed map for inline cards
      "tool.update": { messageId: string; call: ToolCallRecord };
      // feature 023: manual-run progress + runtime session transitions
      "script.run": ScriptRunEvent;
      "session.state": SessionStateEvent;
      // feature 013: pushed on every devkit status transition + progress
      "update.status": UpdateView;
      // feature 017
      "extension.changed": { pack: InstalledPackView };
      "run.event": { runId: string; entry: TraceEntry };
      "run.status": {
        runId: string;
        status: RunRecord["status"];
        error?: { code: RpcErrorCode; message: string; path?: string };
      };
      "view.error": { sessionId: string; message: string };
    };
  };
}
