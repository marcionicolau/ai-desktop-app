export type MessageRole = "user" | "assistant";

// generating = in-flight stream; partial = stopped or recovered after crash;
// failed = inference error (content retains what was generated)
export type MessageStatus = "generating" | "complete" | "partial" | "failed";

export type ModelStatus = "unloaded" | "loading" | "ready" | "error";

export interface MessageStats {
  tokens: number;
  tokensPerSec: number;
}

// feature 009: files attached to a user turn. Content lives on disk
// (dataDir/attachments/<id>) — the record carries metadata + budget status.
export type AttachmentStatus = "full" | "truncated" | "excluded";

export interface MessageAttachment {
  id: string;
  fileName: string;
  sizeBytes: number;
  status: AttachmentStatus;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  createdAt: string;
  completedAt: string | null;
  stats?: MessageStats | null;
  // fusion turns only: plan artifact + per-phase provenance
  phases?: MessagePhases | null;
  // feature 005: id of the preceding message on this branch; null/absent
  // = first message or legacy pre-005 message (linear backfill on load)
  parentId?: string | null;
  // feature 009: attach-order file records; content resolvable by id
  attachments?: MessageAttachment[] | null;
  // feature 015: structured verdicts for fenced tool_call blocks in
  // content (emission order); absent = no tool activity this turn
  toolCalls?: ToolCallRecord[] | null;
}

export type ConversationMode = "single" | "fusion";

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  mode: ConversationMode;
  plannerTag: string;
  executorTag: string;
  // feature 005: id of the deepest message on the displayed branch;
  // null/absent = last message in array order (legacy default)
  activeLeaf?: string | null;
  // feature 006: 0-or-1 assigned persona; absent = unassigned
  personaName?: string | null;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  personaName?: string | null; // feature 006: sidebar badge
}

// ---- feature 007: cross-conversation search ----

export interface SearchHit {
  messageId: string;
  role: "user" | "assistant";
  timestamp: string;
  // ~80 chars of context around the first match; matchStart/matchEnd
  // delimit the match inside `snippet` for highlight rendering
  snippet: string;
  matchStart: number;
  matchEnd: number;
}

export interface SearchGroup {
  conversationId: string;
  title: string;
  updatedAt: string;
  personaName?: string | null;
  // true when the query matched the title (hits may still be empty)
  titleMatched: boolean;
  hits: SearchHit[]; // ≤3, earliest message first
}

export interface SearchResponse {
  groups: SearchGroup[]; // ≤20, ordered by updatedAt desc
}

export interface ModelInfo {
  path: string;
  name: string;
  status: ModelStatus;
  error: string | null;
}

export interface GenerationParams {
  temperature: number; // 0.0-2.0; 0 = greedy
  topP: number; // 0.0-1.0; 1 = off
  topK: number; // >=0; 0 = off
  repeatPenalty: number; // >=0; 1 = off
  seed: number; // uint32; 0 = random
  maxTokens: number; // >=0; 0 = context-bound
  nThreads: number; // >=0; 0 = default
  nGpuLayers: number; // >=0; 0 = CPU
}

export const DEFAULT_GENERATION: GenerationParams = {
  temperature: 0,
  topP: 1,
  topK: 0,
  repeatPenalty: 1,
  seed: 0,
  maxTokens: 512,
  nThreads: 0,
  nGpuLayers: 0,
};

export interface ModelMeta {
  path: string;
  fileName: string;
  sizeBytes: number;
  name: string | null;
  architecture: string | null;
  paramCount: string | null;
  quantization: string | null;
  contextTrain: number | null;
}

export type DownloadPhase = "progress" | "done" | "error";

export interface DownloadState {
  fileName: string;
  phase: DownloadPhase;
  downloadedBytes: number;
  totalBytes: number | null;
  error?: string;
}

export interface Settings {
  activeModelPath: string | null;
  contextLimitWarning: boolean;
  generation: GenerationParams;
  // per-model overrides keyed by model file basename
  modelOverrides: Record<string, Partial<GenerationParams>>;
  // named model roles; "default" is provisioned and synced to
  // activeModelPath (feature 004, FR-010)
  tags: ModelTag[];
  // feature 006: optional so the service can distinguish unset (→ seed
  // starters) from [] (user deleted all — never re-seed)
  personas?: Persona[];
  snippets?: Snippet[];
  // feature 010: KV snapshot policy; undefined →
  // {enabled:true, maxBytes:2GiB} (opt-out, not opt-in)
  snapshot?: SnapshotPolicy;
  // feature 016: output/metrics panel toggle; default off
  outputPanel?: boolean;
  // feature 015: undefined → {sandboxRoot: null, mode: "deny"} —
  // tools inactive until a root is configured
  tools?: ToolPolicy;
}

// ---- feature 015: sandboxed local tool use ----

export type ToolName = "read_file" | "list_dir";

// verdict = status in UI wording. refused = rejected before prompting
// (out-of-sandbox / cap exhausted / tools disabled); denied = user said no
export type ToolCallStatus =
  | "pending"
  | "approved"
  | "denied"
  | "refused"
  | "executed"
  | "error";

export type ToolRefuseReason =
  | "out-of-sandbox"
  | "budget"
  | "malformed"
  | "disabled";

export interface ToolCallRecord {
  id: string;
  tool: ToolName | null; // null when the block failed schema validation
  path: string;
  resolvedPath?: string; // canonical path once it resolves in-sandbox
  status: ToolCallStatus;
  refuseReason?: ToolRefuseReason;
  error?: string;
  resultPreview?: string; // <=200 chars, single line — card summary
  resultBytes?: number; // post-truncation injected size
  createdAt: string;
  decidedAt?: string;
}

export type ToolMode = "ask" | "allow-read-session" | "deny";

export interface ToolPolicy {
  sandboxRoot: string | null; // absolute path; null = tools inactive
  mode: ToolMode;
}

// append-only audit line (dataDir()/tool-audit.jsonl), one per
// executed-or-errored call — survives conversation deletion (FR-011)
export interface AuditEntry {
  ts: string;
  conversationId: string;
  messageId: string;
  callId: string;
  tool: ToolName;
  path: string;
  resolvedPath: string;
  verdict: "executed" | "error";
  resultBytes?: number;
  error?: string;
}

// feature 016: one metrics entry per generation call (session ring, FR-007)
export interface MetricEntry {
  id: string;
  ts: string; // call completion time
  conversationId: string;
  modelFile: string; // serving model basename (fallback-aware)
  roleKey: string; // "main" | "planner" | "executor"
  tag?: string; // resolved role tag
  personaName?: string; // captured at call time
  promptTokens: number;
  outputTokens: number;
  elapsedMs: number;
  warm: boolean; // KV prefix/state reuse hit
  status: "complete" | "partial" | "failed";
  fallback?: boolean;
  promptPreview: string; // ≤120 chars, single line
}

// feature 010: disk bounds for persisted KV state
export interface SnapshotPolicy {
  enabled: boolean;
  maxBytes: number; // LRU evict while total exceeds this
}

// feature 010
export interface SnapshotStats {
  count: number;
  usedBytes: number;
  maxBytes: number;
}

export interface SnapshotClearResult {
  removed: number;
  freedBytes: number;
}

// feature 006: a reusable steering bundle, one per conversation
export interface Persona {
  name: string; // slug, SLUG_RE, unique
  systemPrompt: string; // non-empty, <= 8 KiB
  params: Partial<GenerationParams> | null;
  preferredTag?: string;
}

// feature 006: insertable prompt fragment for the "/" composer picker;
// name unique across snippets AND personas (shared picker namespace)
export interface Snippet {
  name: string;
  text: string;
}

// ---- Feature 004: tagged model roles & fusion ----

export type RoleRef =
  | { kind: "tag"; name: string }
  | { kind: "model"; fileName: string };

export type RoleState = "bound" | "unbound" | "broken";

export interface ModelTag {
  name: string; // unique slug /^[a-z0-9]+(-[a-z0-9]+)*$/, 1-32 chars
  label?: string;
  description?: string;
  binding: string | null; // bound file basename; null = unbound
  params: Partial<GenerationParams>; // per-tag overrides (top of cascade)
  fallback: RoleRef[]; // ordered, max 3, cycle-checked
}

export type RoleServedBy =
  | { kind: "primary" }
  | { kind: "fallback"; via: RoleRef };

export interface ResolvedRole {
  tag: string;
  fileName: string;
  path: string;
  params: GenerationParams; // DEFAULT < global < file < tag (final)
  servedBy: RoleServedBy;
}

// role.list view: tag + derived state + bound model metadata
export interface RoleView extends ModelTag {
  state: RoleState;
  resolvedFile?: ModelMeta;
}

export type FusionPhase = "plan" | "answer";

// chat.done stats: flat MessageStats in single mode nests under `answer`+`total`
export interface TurnStats {
  plan?: MessageStats;
  answer?: MessageStats;
  total?: MessageStats;
}

export interface MessagePhases {
  plan?: {
    content: string;
    stats?: MessageStats | null;
    tag: string;
    fileName: string;
    servedBy?: "primary" | "fallback";
  };
  answer?: {
    stats?: MessageStats | null;
    tag?: string;
    fileName?: string;
    servedBy?: "primary" | "fallback";
  };
}

// feature 011: measured benchmark + live fit verdict. Persisted in
// dataDir()/benchmarks.json keyed by fingerprint ("fileName:sizeBytes").
export interface BenchmarkRecord {
  fingerprint: string;
  tokensPerSec: number;
  peakBytes: number;
  measuredAt: string;
  // wall-time cap cut the run short — still a real measurement
  partial?: boolean;
}

export type FitVerdict = "fits" | "tight" | "wontfit";
export type AdviseBasis = "measured" | "estimated";

export interface ModelAdvise {
  path: string;
  fileName: string;
  benchmark?: BenchmarkRecord;
  verdict: FitVerdict;
  recommendedCtx: number;
  basis: AdviseBasis;
  basisBytes: number;
}

export interface FusionAdvise {
  planner: string;
  executor: string;
  sequentialPeakBytes: number; // max(a, b) — phases run serially
  combinedBytes: number; // a + b — both weights resident
  verdict: FitVerdict;
}

// ---- feature 017: extension packs + fabric runs ----

import type {
  PackManifest,
  ParamDecl,
  PortDecl,
  ViewDecl,
  CommandDecl,
} from "./pack-schema";

export type PackSource =
  | { kind: "folder"; path: string }
  | { kind: "archive"; path: string }
  | { kind: "url"; url: string }
  | { kind: "registry"; url: string; entry: string };

export type PackState = "installed" | "enabled" | "disabled" | "failed";

export interface InstalledPackView {
  id: string;
  dir: string;
  state: PackState;
  error?: { code: string; message: string; file?: string; path?: string };
  source: { kind: PackSource["kind"]; ref: string };
  manifest: PackManifest;
  installedAt: number;
}

export interface SkillView {
  id: string; // <packId>:<name>
  packId: string;
  name: string;
  domain?: string;
  version: string;
  runtime: string; // "prompt" | "component:<id>"
  description: string;
  inputs: Record<string, PortDecl>;
  outputs: Record<string, PortDecl>;
  params: Record<string, ParamDecl>;
  guidance: { whenToUse?: string; interpreting?: string; mistakes?: string };
}

export interface PipelineView {
  id: string;
  packId: string;
  name: string;
  description: string;
  steps: { id: string; uses: string; params?: Record<string, unknown>; inputs?: Record<string, string> }[];
}

export interface AgentView {
  id: string;
  packId: string;
  name: string;
  kind: "router" | "sequential" | "planner" | "llm" | "pipeline";
  model?: string;
  children: AgentView[];
  fallback?: string;
  pipeline?: string;
}

export interface PackContributionsView {
  skills: SkillView[];
  pipelines: PipelineView[];
  agents: AgentView[];
  views: ViewDecl[];
  commands: CommandDecl[];
}

export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface Budget {
  maxSteps?: number;
  maxDelegations?: number;
  maxModelCalls?: number;
  maxDepth?: number;
}

export interface TraceEntry {
  seq: number;
  stepId: string;
  kind: "step" | "delegation" | "artifact" | "note";
  path: string; // e.g. "lead/team/worker"
  status: string;
  input?: unknown;
  output?: unknown;
  startedAt?: number;
  endedAt?: number;
}

export interface Artifact {
  name: string;
  type: PortDecl["type"];
  value: unknown;
  stepId: string;
}

export interface RunRecord {
  id: string;
  packId: string;
  target: { kind: "pipeline" | "agent"; id: string };
  objective: string;
  params: Record<string, unknown>;
  status: RunStatus;
  trace: TraceEntry[];
  artifacts: Artifact[];
  budget: Budget;
  usage: {
    steps: number;
    delegations: number;
    modelCalls: number;
    promptTokens: number;
    outputTokens: number;
    elapsedMs: number;
  };
  error?: { code: string; message: string; path?: string };
  startedAt: number;
  endedAt?: number;
}

export interface RunSummary {
  id: string;
  packId: string;
  target: RunRecord["target"];
  objective: string;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
}
