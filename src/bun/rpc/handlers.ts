// RPC handlers for the chat schema (contracts/rpc.md).
// createRequestHandlers is dependency-injected so tests/rpc can exercise the
// contract without the Electrobun bridge or a real model.
import { defineElectrobunRPC } from "electrobun/main/rpc";
import type { ChatRpcSchema, RpcErrorCode } from "../../shared/rpc-contract";
import type {
  BenchmarkRecord,
  Conversation,
  FusionAdvise,
  GenerationParams,
  Message,
  MetricEntry,
  ModelAdvise,
  ModelStatus,
  Persona,
  ResolvedRole,
  Snippet,
  RoleRef,
  PackSource,
  UpdateChannel,
  UpdateView,
} from "../../shared/types";
import { DEFAULT_GENERATION } from "../../shared/types";
import { EngineError } from "../llama/engine";
import { mergeParams, validateParams } from "../llama/params";
import { buildPrompt, composeSystem, type PromptTurn } from "../llama/prompt";
import { runToolLoop } from "../tools/loop";
import { ToolService } from "../tools/service";
import { modelsDir, scanModels } from "../models/library";
import { downloadGguf, validateGgufTarget } from "../models/download";
import { DEFAULT_MODEL, SetupService } from "../setup/service";
import { runBenchmark } from "../advisor/benchmark";
import { fingerprint, loadBenchmarks } from "../advisor/store";
import {
  fitVerdict,
  fusionFit,
  headroom,
  kvPerToken,
  recommendedCtx,
} from "../advisor/verdicts";
import { freemem, totalmem } from "node:os";
import { ModelRegistry, createRegistryEngine } from "../models/registry";
import { RolesService } from "../models/roles";
import { PersonaService } from "../personas/service";
import { SearchIndex } from "../search/index";
import { runFusionTurn } from "../llama/fusion";
import {
  gcFor,
  pickAndStore,
  resolveMany,
} from "../attachments/store";
import { fitBudget, plannerSummary } from "../attachments/inject";
import {
  buildBackupEnvelope,
  buildEnvelope,
  renderMarkdown,
  uniqueFileName,
} from "../export/exporter";
import {
  parseEnvelope,
  remapConversation,
  toSettings,
} from "../export/importer";
import * as store from "../store/json-store";
import { backfillTree } from "../store/json-store";
import {
  DEFAULT_SNAPSHOT_POLICY,
  SnapshotStore,
} from "../kv/store";
import { MetricsStore } from "../metrics/store";
import { ContributionRegistry } from "../fabric/registry";
import { ExtensionsStore } from "../extensions/store";
import { RunManager } from "../fabric/runtime";
import { ViewManager, type ViewFactory } from "../extensions/views";
import { createViewBridge } from "../extensions/bridge";
import { electrobunViewFactory, type HostTarget } from "../extensions/electrobun-view";
import { Updater } from "electrobun/main/updater";
import { UpdateError, UpdateService } from "../updater/service";
import type { UpdateServiceLike } from "../updater/types-internal";
import {
  deepestLeaf,
  leafOf,
  parentOf,
  pathOf,
  pathToLeaf,
} from "../store/tree";
import {
  existsSync,
  mkdirSync,
  statSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

type Events = ChatRpcSchema["webview"]["messages"];
type Emit = <M extends keyof Events>(method: M, payload: Events[M]) => void;

// feature 011: benchmarks run at the shim's default ctx (D3); unmeasured
// models fall back to a conservative 256 KiB/token KV estimate over a 4 k
// ctx (flagged basis: "estimated" — never presented as measured)
const BENCH_CTX = 2048;
const EST_KV = 256 * 1024;
const EST_CTX = 4096;
// module-level single-flight flag for benchmark runs (independent of
// engine.isGenerating — a benchmark holds the engine itself)
let benchmarking = false;

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
    opts?: {
      conversationId?: string;
      roleKey?: string; // feature 010
      snapshot?: SnapshotStore; // feature 010
    },
  ): Promise<{
    status: "complete" | "partial";
    tokens: number;
    elapsedMs: number;
    warm: boolean;
    // feature 016: exact prompt tokenization; absent on fake engines
    promptTokens?: number;
  }>;
  stop(): void;
  // feature 010: persist resident KV for the tagged conversation
  saveState?(store: SnapshotStore): void;
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
  // feature 004: optional so existing tests keep a two-dep harness
  roles?: RolesService;
  registry?: ModelRegistry;
  // feature 006: personas/snippets service; absent in two-dep harnesses
  personas?: PersonaService;
  // feature 010: snapshot store; absent → module singleton in prod,
  // disabled in tests that don't inject one
  snapshots?: SnapshotStore;
  // feature 016: metrics ring; absent → panel off in tests
  metrics?: MetricsStore;
  // feature 015: tool policy/grants/deferrals; absent → tools disabled
  // (prompt injection off; stray blocks refuse as "disabled")
  tools?: ToolService;
  // feature 008: file pickers, injectable for headless tests
  dialogs?: {
    pickFolder(): Promise<string | null>;
    pickFile(allowedTypes?: string): Promise<string | null>;
    // feature 009: multi-select; default = wrap pickFile
    pickFiles?(allowedTypes?: string): Promise<string[] | null>;
  };
  // feature 017: extension pack store; absent → feature off (tests)
  extensions?: ExtensionsStore;
  fabric?: RunManager;
  views?: ViewManager;
  viewFactory?: ViewFactory;
  // feature 013: update service; absent → update.* rejects UPDATE_DISABLED
  updater?: UpdateServiceLike;
  // feature 022: first-run bootstrap; absent → setup.* returns idle/no-op
  setup?: SetupService;
}

function fail(code: RpcErrorCode, message: string): never {
  throw new EngineError(code, message);
}

// feature 013: bridge UpdateService's UpdateError to the RPC error code
const updateCall = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof UpdateError) fail(e.code, e.message);
    throw e;
  }
};

const IDLE_UPDATE_VIEW: UpdateView = {
  status: "idle",
  current: { version: "0.0.0", channel: "dev" },
  preferredChannel: "canary",
};

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();

// turns strictly before the given message on its branch, newest-first,
// usable as buildPrompt history (feature 005: ancestor path, not array slice)
const turnsBefore = (conv: Conversation, msg: Message): PromptTurn[] =>
  pathToLeaf(conv, msg)
    .slice(0, -1)
    .filter((m) => m.status === "complete" || m.status === "partial")
    .toReversed()
    .map((m) => ({ role: m.role, content: m.content }));

const isCtxOverflow = (e: unknown) =>
  e instanceof Error && e.message.includes("context window");

// feature 016: single-line <=120-char prompt preview (clarified scope —
// full bodies never leave the engine)
const preview = (t: string) => t.replace(/\s+/g, " ").slice(0, 120);

// feature 021: resolved color scheme reported by the renderer via
// settings.set{resolvedTheme}; transient (not persisted), defaults dark
// to match the app's original palette.
let resolvedTheme: "light" | "dark" = "dark";

export function createRequestHandlers(deps: HandlerDeps) {
  let activeMessageId: string | null = null;
  // a stop that lands before the engine starts (run() yields first so
  // chat.send can answer, then load+prefill block the loop) — honored
  // at the earliest moment generation can observe it
  let pendingStop: string | null = null;
  // feature 010: absent dep → snapshot layer off (tests); prod injects
  // the module singleton via createRpc
  const snap = deps.snapshots ?? null;
  // feature 015: lazily built so tests without the dep get a disabled
  // service (deny default) rather than a crash
  let toolsSvc: ToolService | null = null;
  const tools = () =>
    (toolsSvc ??=
      deps.tools ?? new ToolService({ getSettings: () => deps.store.getSettings() }));
  // feature 015: turn-level busy — covers the approval pause where the
  // engine itself is not generating
  // feature 017 (I2): an active fabric run holds the engine too —
  // serialization is bidirectional
  const turnBusy = () =>
    deps.engine.isGenerating() || activeMessageId !== null || fabric.isRunning();
  // feature 016: gated on settings.outputPanel — off ⇒ zero entries
  const recordCall = (e: Omit<MetricEntry, "id" | "ts">) => {
    if (!deps.metrics || !deps.store.getSettings().outputPanel) return;
    deps.emit("metrics.entry", deps.metrics.record(e));
  };
  const snapSync = () => {
    if (!snap) return null;
    snap.policy = {
      ...DEFAULT_SNAPSHOT_POLICY,
      ...deps.store.getSettings().snapshot,
    };
    return snap;
  };

  const persist = (conv: Conversation) => deps.store.saveConversation(conv);

  // feature 006: persona params slot between global and model override —
  // DEFAULT < global < persona < modelOverride (tag applied in roles.ts)
  const resolveGenParams = (
    persona?: Partial<GenerationParams> | null,
  ): GenerationParams => {
    const settings = deps.store.getSettings();
    const modelKey = deps.engine.status().name ?? "";
    return mergeParams(
      mergeParams(
        mergeParams(DEFAULT_GENERATION, settings.generation),
        persona,
      ),
      modelKey ? settings.modelOverrides?.[modelKey] : undefined,
    );
  };

  const rolesSvc = () => deps.roles ?? new RolesService({ store: deps.store });

  // feature 007: one index per handler set; lazily refreshed per query
  // from deps.store (updatedAt-keyed — always consistent by construction)
  let searchIdx: SearchIndex | null = null;
  const searchIndex = () => (searchIdx ??= new SearchIndex(deps.store));

  const personasSvc = () =>
    deps.personas ??
    new PersonaService({
      store: deps.store,
      tagNames: () => rolesSvc().list().map((t) => t.name),
      getConversation: (id) => deps.store.getConversation(id),
      saveConversation: (c) => deps.store.saveConversation(c),
    });

  // feature 017: fabric run manager + view sessions (lazy so tests without
  // deps get isolated instances; prod injects via createRpc)
  const contribReg = new ContributionRegistry();
  const fabric =
    deps.fabric ??
    new RunManager({
      registry: contribReg,
      engine: () => deps.engine,
      onTrace: (runId, entry) => deps.emit("run.event", { runId, entry }),
      onStatus: (runId, status, error) => {
        deps.emit("run.status", {
          runId,
          status,
          error: error
            ? { ...error, code: error.code as RpcErrorCode }
            : undefined,
        });
        // FR-015: live run updates reach the owning pack's open views
        const rec = fabric.get(runId);
        if (rec) {
          viewMgr().emitToPack(rec.packId, "ext.runUpdated", { runId, status });
        }
      },
    });
  let viewMgrInst: ViewManager | null = null;
  const viewMgr = () =>
    (viewMgrInst ??=
      deps.views ??
      new ViewManager({
        factory: deps.viewFactory,
        onError: (sessionId, message) => deps.emit("view.error", { sessionId, message }),
      }));
  // feature 017: lazily built; tests without the dep get an isolated
  // store+registry (feature still functional, state under APP_DATA_DIR)
  let extStoreInst: ExtensionsStore | null = null;
  const extStore = () =>
    (extStoreInst ??=
      deps.extensions ??
      new ExtensionsStore({
        registry: contribReg,
        onDisable: (packId) => {
          fabric.abortPackRuns(packId);
          viewMgr().closeFor(packId);
        },
        onRemove: (packId, purgeData) => {
          fabric.abortPackRuns(packId);
          viewMgr().closeFor(packId);
          if (purgeData) fabric.clear(packId);
        },
      }));

  const findMessage = (messageId: string) => {
    for (const summary of deps.store.listConversations()) {
      const conv = deps.store.getConversation(summary.id);
      const msg = conv?.messages.find((m) => m.id === messageId);
      if (conv && msg) {
        // normalize pre-005 fixtures/stores to a linear chain
        backfillTree(conv);
        return { conv, msg };
      }
    }
    return null;
  };

  // shared generation driver for chat.send / chat.regenerate / chat.edit:
  // builds the budgeted prompt from (history, current), streams tokens into
  // assistantMsg, persists, and emits chat.token/done/error. FR-011: the
  // token budget halves and retries on real context overflow.
  // feature 009: budget estimate for attachment fit — the real prompt
  // budget is derived inside the generation loop; mirror its formula so
  // recorded statuses match what was actually injected
  const attachBudget = (): number => {
    const cs = deps.engine.contextSize();
    if (cs <= 0) return 2048;
    return Math.max(256, cs - Math.min(512, Math.floor(cs / 2)));
  };

  // resolve attachment ids -> file blocks + status records + planner
  // text. Returns null when no attachments are involved.
  const buildAttachmentContext = (
    ids: string[] | undefined,
    text: string,
  ): {
    current: string;
    plannerText: string;
    records: import("../../shared/types").MessageAttachment[];
    warnings: string[];
  } | null => {
    if (!ids?.length) return null;
    const atts = resolveMany(ids); // unknown id -> INVALID_PARAMS
    const fit = fitBudget(atts, text, attachBudget());
    const summary = plannerSummary(atts);
    return {
      current: fit.injectText + text,
      plannerText: summary ? `${text}\n\n${summary}` : text,
      records: fit.records,
      warnings: fit.warnings,
    };
  };

  const streamAssistant = (
    conv: Conversation,
    assistantMsg: Message,
    history: PromptTurn[],
    current: string,
    plannerText?: string,
  ): void => {
    // FR-010: single-mode generation resolves through the `default` tag;
    // when the roles dep is absent (unit-test harness) fall back to the
    // legacy per-model param merge.
    // candidate list for the runtime fallback cascade (T019); legacy
    // test harness without roles dep gets a single implicit candidate
    // feature 006: the conversation's persona steers every turn on it —
    // system prompt injected into the prompt, params merged into the
    // cascade. Missing/dangling assignment is ignored (SC-004).
    const persona = conv.personaName
      ? personasSvc().get(conv.personaName)
      : null;
    let candidates: ResolvedRole[] = [];
    if (deps.roles) {
      try {
        candidates = deps.roles.resolveCandidates(
          "default",
          0,
          persona?.params ?? null,
        );
      } catch {
        candidates = [];
      }
    }
    const legacyGenParams = resolveGenParams(persona?.params);
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
    const run = async () => {
      // yield once up front: the request that spawned this run (send /
      // regenerate / edit) must respond before the synchronous FFI
      // prefix — model load + prompt prefill — blocks the event loop,
      // otherwise callers hit the bridge's RPC-request timeout
      await new Promise((r) => setTimeout(r, 0));
      if (pendingStop === messageId) {
        pendingStop = null;
        return { status: "partial" as const, tokens: 0, elapsedMs: 0 };
      }
      // fusion mode: two-phase planner -> executor via the orchestrator
      if (conv.mode === "fusion" && deps.roles && deps.registry) {
        // FR-009: persona params go to the executor only; the planner
        // resolves with the bare cascade (its directive stays its own)
        const planner = deps.roles.resolveCandidates(conv.plannerTag);
        const executor = deps.roles.resolveCandidates(
          conv.executorTag,
          0,
          persona?.params ?? null,
        );
        if (planner.length === 0) {
          fail("ROLE_UNBOUND", `planner role "${conv.plannerTag}" has no bound model`);
        }
        if (executor.length === 0) {
          fail("ROLE_UNBOUND", `executor role "${conv.executorTag}" has no bound model`);
        }
        // feature 015 (FR-009/FR-012): instructions go to the executor's
        // system prompt only when tools are active; the planner's output
        // is never scanned — only the executor may issue calls
        const toolsActive =
          tools().active() && tools().sandbox() !== null;
        const res = await runFusionTurn({
          planner,
          executor,
          registry: deps.registry,
          snapshot: snapSync() ?? undefined,
          conversationId: conv.id,
          history,
          current,
          plannerText,
          executorSystem: composeSystem(persona?.systemPrompt, toolsActive),
          tools: {
            service: tools(),
            messageId,
            isStopped: () => pendingStop === messageId,
            onBudgetWarning: () =>
              deps.emit("chat.warning", {
                messageId,
                code: "TOOL_BUDGET",
                message:
                  "Tool-call limit reached for this turn; the model was told to finish.",
              }),
            onCall: (call) => {
              assistantMsg.toolCalls ??= [];
              const i = assistantMsg.toolCalls.findIndex(
                (x) => x.id === call.id,
              );
              if (i >= 0) assistantMsg.toolCalls[i] = { ...call };
              else assistantMsg.toolCalls.push({ ...call });
              dirty = true;
              deps.emit("tool.update", { messageId, call: { ...call } });
            },
          },
          onTruncated: warnTruncated,
          // feature 016: one entry per phase; persona added here so
          // fusion.ts stays persona-agnostic
          onMetric: (e) =>
            recordCall({
              ...e,
              personaName: conv.personaName ?? undefined,
            }),
          onEvent: (m, p) =>
            deps.emit(
              m as never,
              { messageId, ...(p as Record<string, unknown>) } as never,
            ),
          onPlanDelta: () => {
            dirty = true;
          },
          onAnswerDelta: (d) => {
            assistantMsg.content += d;
            dirty = true;
          },
        });
        assistantMsg.phases = {
          plan: res.plan,
          answer: res.answer
            ? {
                stats: res.answer.stats,
                tag: res.answer.tag,
                fileName: res.answer.fileName,
                servedBy: res.answer.servedBy,
              }
            : undefined,
        };
        return {
          status: res.status,
          turnStats: {
            plan: res.plan?.stats ?? undefined,
            answer: res.answer?.stats ?? undefined,
            total: res.answer?.stats ?? res.plan?.stats ?? undefined,
          },
        };
      }
      // runtime fallback cascade (T019): try each candidate in order;
      // retry only when failure precedes the first emitted token so a
      // mid-stream error never produces duplicated output
      const attempts: { role: ResolvedRole | null; path: string | null }[] =
        deps.roles && deps.registry
          ? candidates.map((r) => ({ role: r, path: r.path }))
          : [{ role: null, path: null }];
      if (deps.roles && deps.registry && attempts.length === 0) {
        throw new EngineError(
          "ROLE_UNBOUND",
          'role "default" has no bound model',
        );
      }
      let lastErr: unknown;
      for (const attempt of attempts) {
        let eng: EngineLike = deps.engine;
        let slotPath: string | null = null;
        let emitted = false;
        let attemptText = ""; // feature 016: deltas for failed-entry tokens
        let recorded = false;
        const attemptT0 = performance.now();
        const recFail = () => {
          if (recorded) return;
          recorded = true;
          recordCall({
            conversationId: conv.id,
            modelFile: attempt.role?.fileName ?? eng.status().name ?? "?",
            roleKey: "main",
            tag: attempt.role?.tag,
            personaName: conv.personaName ?? undefined,
            promptTokens: eng.tokenCount(current),
            outputTokens: attemptText ? eng.tokenCount(attemptText) : 0,
            elapsedMs: Math.round(performance.now() - attemptT0),
            warm: false,
            status: "failed",
            fallback: attempt.role?.servedBy.kind === "fallback" || undefined,
            promptPreview: preview(current),
          });
        };
        const genParams = attempt.role
          ? attempt.role.params
          : legacyGenParams;
        try {
          if (attempt.path && deps.registry) {
            // oxlint-disable-next-line no-await-in-loop -- sequential candidate cascade
            const slot = await deps.registry.acquire(attempt.path);
            deps.registry.pin(slot.path, conv.id);
            slotPath = slot.path;
            eng = slot.engine;
          }
          const ctxSize = eng.contextSize();
          const reserve = Math.min(512, Math.floor(ctxSize / 2) || 512);
          const baseBudget = ctxSize > 0 ? ctxSize - reserve : Infinity;
          const chatml = (eng.chatTemplate() ?? "").includes("im_start");
          const costOf = (t: { content: string }) =>
            eng.tokenCount(t.content) + 8; // ~wrapper tokens per turn
          // feature 015 (FR-012): tool instructions only when the policy
          // is active AND the sandbox actually exists — deny/unset root
          // yields the persona-only system prompt (byte-identical)
          const toolsActive =
            tools().active() && tools().sandbox() !== null;
          let budget = baseBudget;
          for (;;) {
            const built = buildPrompt(history, current, {
              chatml,
              budget,
              costOf,
              system: composeSystem(persona?.systemPrompt, toolsActive),
            });
            if (built.truncated) warnTruncated();
            try {
              // oxlint-disable-next-line no-await-in-loop -- sequential budget-halving retry
              const r = await runToolLoop(eng, built.prompt, {
                tools: tools(),
                conversationId: conv.id,
                messageId,
                genParams,
                genOpts: {
                  conversationId: conv.id,
                  snapshot: snapSync() ?? undefined,
                },
                isStopped: () => pendingStop === messageId,
                onBudgetWarning: () =>
                  deps.emit("chat.warning", {
                    messageId,
                    code: "TOOL_BUDGET",
                    message:
                      "Tool-call limit reached for this turn; the model was told to finish.",
                  }),
                onCall: (call) => {
                  assistantMsg.toolCalls ??= [];
                  const i = assistantMsg.toolCalls.findIndex(
                    (x) => x.id === call.id,
                  );
                  if (i >= 0) assistantMsg.toolCalls[i] = { ...call };
                  else assistantMsg.toolCalls.push({ ...call });
                  dirty = true;
                  deps.emit("tool.update", { messageId, call: { ...call } });
                },
                onDelta: (delta) => {
                  if (!emitted) {
                    emitted = true;
                    // surface fallback service in the chat timeline
                    if (attempt.role?.servedBy.kind === "fallback") {
                      deps.emit("chat.phase", {
                        messageId,
                        phase: "answer",
                        tag: attempt.role.tag,
                        fileName: attempt.role.fileName,
                        servedBy: "fallback",
                      });
                    }
                  }
                  assistantMsg.content += delta;
                  attemptText += delta;
                  dirty = true;
                  deps.emit("chat.token", { messageId, delta });
                  // a stop queued during load/prefill lands on first token
                  if (pendingStop === messageId) deps.engine.stop();
                },
              });
              recordCall({
                conversationId: conv.id,
                modelFile:
                  attempt.role?.fileName ?? eng.status().name ?? "?",
                roleKey: "main",
                tag: attempt.role?.tag,
                personaName: conv.personaName ?? undefined,
                promptTokens:
                  r.promptTokens ?? eng.tokenCount(built.prompt),
                outputTokens: r.tokens,
                elapsedMs: r.elapsedMs,
                warm: r.warm,
                status: r.status,
                fallback:
                  attempt.role?.servedBy.kind === "fallback" || undefined,
                promptPreview: preview(current),
              });
              recorded = true;
              if (attempt.role?.servedBy.kind === "fallback") {
                assistantMsg.phases = {
                  answer: {
                    tag: attempt.role.tag,
                    fileName: attempt.role.fileName,
                    servedBy: "fallback",
                  },
                };
              }
              return {
                status: r.status,
                tokens: r.tokens,
                elapsedMs: r.elapsedMs,
              };
            } catch (e) {
              if (!isCtxOverflow(e) || budget <= 256) {
                recFail(); // feature 016: failed calls still record
                throw e;
              }
              budget = Math.floor(budget / 2);
            }
          }
        } catch (e) {
          lastErr = e;
          recFail();
          if (emitted) throw e;
          // try next candidate
        } finally {
          if (slotPath && deps.registry) deps.registry.release(slotPath);
        }
      }
      throw lastErr;
    };

    void run()
      .then((res) => {
        assistantMsg.status = res.status;
        assistantMsg.completedAt = now();
        const stats =
          "turnStats" in res
            ? null
            : res.tokens > 0
              ? {
                  tokens: res.tokens,
                  tokensPerSec:
                    Math.round((res.tokens / (res.elapsedMs / 1000)) * 10) / 10,
                }
              : null;
        assistantMsg.stats = stats;
        conv.updatedAt = now(); // feature 007: freshness key for the
        // search index — a completed turn is "recent activity"
        persist(conv);
        deps.emit("chat.done", {
          messageId,
          status: res.status,
          stats:
            "turnStats" in res
              ? res.turnStats
              : stats
                ? { answer: stats, total: stats }
                : undefined,
        });
      })
      .catch((e: unknown) => {
        assistantMsg.status = "failed";
        assistantMsg.completedAt = now();
        conv.updatedAt = now(); // feature 007: terminal-state freshness
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
        if (pendingStop === messageId) pendingStop = null;
      });
  };

  const requireBound = (kind: string, tag: string) => {
    try {
      rolesSvc().resolve(tag);
    } catch (e) {
      if (e instanceof EngineError && e.code === "ROLE_UNBOUND") {
        fail(
          "ROLE_UNBOUND",
          `${kind} role "${tag}" has no bound model — bind it in the Roles panel`,
        );
      }
      throw e;
    }
  };

  return {
    // fire-and-forget: the FFI load blocks the loop for seconds on big
    // models — respond now and drive completion via model.progress
    "model.load": ({ path }: { path: string }) => {
      deps.emit("model.progress", { phase: "loading" });
      void (async () => {
        try {
          const res = await deps.engine.loadModel(path);
          deps.emit("model.progress", { phase: "ready", detail: res.name });
          if (deps.roles) {
            // bind("default") also syncs activeModelPath (FR-010)
            deps.roles.bind("default", path);
            deps.emit("role.changed", { name: "default" });
          } else {
            const settings = deps.store.getSettings();
            deps.store.saveSettings({ ...settings, activeModelPath: path });
          }
        } catch (e) {
          deps.emit("model.progress", {
            phase: "error",
            detail: e instanceof Error ? e.message : String(e),
          });
        }
      })();
      return { status: "loading" as const };
    },
    "model.unload": () => {
      deps.engine.unloadModel();
      if (deps.roles) {
        deps.roles.bind("default", null);
        deps.emit("role.changed", { name: "default" });
      } else {
        const settings = deps.store.getSettings();
        deps.store.saveSettings({ ...settings, activeModelPath: null });
      }
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
    "model.list": () => ({ models: scanModels() }),
    // feature 011: bounded benchmark — single-flight gated, swaps and
    // restores the active model; record persists keyed by fingerprint
    "model.benchmark": async ({ path }: { path: string }) => {
      if (!existsSync(path)) {
        fail("MODEL_NOT_FOUND", `model file not found: ${path}`);
      }
      if (benchmarking || turnBusy()) {
        fail("ENGINE_BUSY", "a generation or benchmark is already active");
      }
      benchmarking = true;
      deps.emit("model.progress", { phase: "loading", detail: "benchmarking" });
      try {
        const prev = deps.store.getSettings().activeModelPath;
        const record = await runBenchmark(deps.engine, path, prev ?? null);
        deps.emit("model.progress", {
          phase: "ready",
          detail: "benchmark complete",
        });
        return { record };
      } catch (e) {
        deps.emit("model.progress", {
          phase: "error",
          detail: e instanceof Error ? e.message : String(e),
        });
        throw e;
      } finally {
        benchmarking = false;
      }
    },
    // feature 011: live verdicts — pure read; never loads a model
    "model.advise": ({
      plannerTag,
      executorTag,
    }: {
      plannerTag?: string;
      executorTag?: string;
    }) => {
      const free = freemem();
      const hr = headroom(totalmem());
      const benchmarks = loadBenchmarks();
      const basisFor = (
        fileName: string,
        sizeBytes: number,
      ): { bytes: number; measured: boolean; kv: number; rec?: BenchmarkRecord } => {
        const rec = benchmarks[fingerprint(fileName, sizeBytes)];
        if (rec) {
          return {
            bytes: rec.peakBytes,
            measured: true,
            kv: kvPerToken(sizeBytes, rec.peakBytes, BENCH_CTX),
            rec,
          };
        }
        return {
          bytes: sizeBytes + EST_KV * EST_CTX,
          measured: false,
          kv: EST_KV,
        };
      };
      const models: ModelAdvise[] = scanModels().map((m) => {
        const b = basisFor(m.fileName, m.sizeBytes);
        const row: ModelAdvise = {
          path: m.path,
          fileName: m.fileName,
          verdict: fitVerdict(b.bytes, free, hr),
          recommendedCtx: recommendedCtx(
            m.sizeBytes,
            b.kv,
            free,
            hr,
            m.contextTrain,
          ),
          basis: b.measured ? "measured" : "estimated",
          basisBytes: b.bytes,
        };
        if (b.rec) row.benchmark = b.rec;
        return row;
      });
      let fusion: FusionAdvise | undefined;
      if (plannerTag && executorTag) {
        try {
          const p = rolesSvc().resolve(plannerTag);
          const e = rolesSvc().resolve(executorTag);
          const pb = basisFor(basename(p.path), statSync(p.path).size);
          const eb = basisFor(basename(e.path), statSync(e.path).size);
          const { sequentialPeakBytes, combinedBytes } = fusionFit(
            pb.bytes,
            eb.bytes,
          );
          fusion = {
            planner: p.fileName,
            executor: e.fileName,
            sequentialPeakBytes,
            combinedBytes,
            verdict: fitVerdict(sequentialPeakBytes, free, hr),
          };
        } catch {
          // unbound/unresolvable tags -> omit the fusion block
        }
      }
      return { models, ...(fusion ? { fusion } : {}) };
    },
    "model.download": ({
      url,
      fileName,
      tagName,
    }: {
      url: string;
      fileName: string;
      tagName?: string;
    }) => {
      const safeName = validateGgufTarget(url, fileName);
      // validate the tag exists before the download starts (FR-004)
      if (tagName !== undefined) {
        const known = rolesSvc()
          .list()
          .some((t) => t.name === tagName);
        if (!known) fail("NOT_FOUND", `role tag not found: ${tagName}`);
      }
      const dir = modelsDir();
      mkdirSync(dir, { recursive: true });
      if (existsSync(join(dir, safeName)) || existsSync(join(dir, safeName + ".part"))) {
        fail("ALREADY_EXISTS", `${safeName} already exists`);
      }
      // feature 022: tell setup a user download is in flight so a
      // concurrent bootstrap never starts (spec FR-007)
      deps.setup?.noteUserDownload(true);
      void downloadGguf(url, fileName, dir, (s) => {
        deps.emit("model.download", s);
        if (s.phase === "done" || s.phase === "error") {
          deps.setup?.noteUserDownload(false);
        }
        if (s.phase === "done" && tagName !== undefined) {
          // FR-004: bind only after the file lands; .part/error never bind
          try {
            rolesSvc().bind(tagName, safeName);
            deps.emit("role.changed", { name: tagName });
          } catch {
            // file downloaded; binding failure surfaces on next role.list
          }
        }
      }).catch(() => {
        // rejection already surfaced via the error event (or thrown
        // before any event — clear the busy flag either way)
        deps.setup?.noteUserDownload(false);
      });
      return { fileName: safeName };
    },
    // feature 022: bootstrap state query + retry. retry is fire-and-
    // forget — progress arrives via the setup.status event (FR-008)
    "setup.status": () =>
      deps.setup?.status() ?? {
        phase: "idle" as const,
        downloadedBytes: 0,
        totalBytes: null,
      },
    "setup.retry": () => {
      void deps.setup?.run();
      return {};
    },
    "chat.send": ({
      conversationId,
      content,
      userMessageId,
      mode,
      plannerTag,
      executorTag,
      attachmentIds,
    }: {
      conversationId: string;
      content: string;
      userMessageId?: string;
      mode?: "single" | "fusion";
      plannerTag?: string;
      executorTag?: string;
      attachmentIds?: string[];
    }) => {
      const text = content.trim();
      if (!text) fail("EMPTY_MESSAGE", "message must not be empty");
      if (turnBusy()) {
        fail("ENGINE_BUSY", "a generation is already in progress");
      }
      if (deps.engine.status().status !== "ready") {
        fail("NO_MODEL", "no model is loaded");
      }

      let conv = deps.store.getConversation(conversationId);
      if (conv) {
        backfillTree(conv); // normalize fake/legacy stores
      } else {
        conv = {
          id: conversationId,
          title: text.slice(0, 40) || "New conversation",
          createdAt: now(),
          updatedAt: now(),
          messages: [],
          mode: mode ?? "single",
          plannerTag: plannerTag ?? "planner",
          executorTag: executorTag ?? "executor",
          activeLeaf: null,
        };
        if (conv.mode === "fusion" && deps.roles) {
          requireBound("planner", conv.plannerTag);
          requireBound("executor", conv.executorTag);
        }
      }

      // history = the active path only (feature 005): dead-end variants
      // never reach the model
      const history = pathOf(conv)
        .filter((m) => m.status === "complete" || m.status === "partial")
        .toReversed()
        .map((m) => ({ role: m.role, content: m.content }));

      const leaf = leafOf(conv);
      const attCtx = buildAttachmentContext(attachmentIds, text);
      const userMsg: Message = {
        id: userMessageId ?? newId(),
        conversationId,
        role: "user",
        content: text,
        status: "complete",
        createdAt: now(),
        completedAt: now(),
        parentId: leaf?.id ?? null,
        attachments: attCtx?.records ?? null,
      };
      const assistantMsg: Message = {
        id: newId(),
        conversationId,
        role: "assistant",
        content: "",
        status: "generating",
        createdAt: now(),
        completedAt: null,
        parentId: userMsg.id,
      };
      conv.messages.push(userMsg, assistantMsg);
      conv.activeLeaf = assistantMsg.id;
      conv.updatedAt = now();
      persist(conv);

      if (attCtx?.warnings.length) {
        deps.emit("chat.warning", {
          messageId: userMsg.id,
          code: "ATTACHMENTS_BUDGET",
          message: attCtx.warnings.join("; "),
        });
      }
      streamAssistant(
        conv,
        assistantMsg,
        history,
        attCtx?.current ?? text,
        attCtx?.plannerText,
      );
      return { messageId: assistantMsg.id };
    },
    "attachment.pick": async () => {
      const paths =
        (await deps.dialogs?.pickFiles?.()) ??
        ((await deps.dialogs?.pickFile()) as string | null);
      if (!paths) return null;
      const list = Array.isArray(paths) ? paths : [paths];
      if (list.length === 0) return null;
      return pickAndStore(list);
    },
    "chat.regenerate": ({ messageId }: { messageId: string }) => {
      if (turnBusy()) {
        fail("ENGINE_BUSY", "a generation is already in progress");
      }
      if (deps.engine.status().status !== "ready") {
        fail("NO_MODEL", "no model is loaded");
      }
      const found = findMessage(messageId);
      const { conv, msg } = found ?? { conv: null, msg: null };
      // feature 005: only the last assistant on the ACTIVE path regenerates;
      // the original variant is preserved as a sibling (append-only)
      const path = conv ? pathOf(conv) : [];
      if (
        !conv ||
        !msg ||
        msg.role !== "assistant" ||
        path.at(-1) !== msg
      ) {
        fail("NOT_FOUND", `assistant turn ${messageId} not found`);
      }
      const userMsg = parentOf(conv, msg);
      if (!userMsg || userMsg.role !== "user") {
        fail("NOT_FOUND", "preceding user turn not found");
      }
      const history = turnsBefore(conv, userMsg);
      const variant: Message = {
        id: newId(),
        conversationId: conv.id,
        role: "assistant",
        content: "",
        status: "generating",
        createdAt: now(),
        completedAt: null,
        parentId: msg.parentId ?? null,
      };
      conv.messages.push(variant);
      conv.activeLeaf = variant.id;
      conv.updatedAt = now();
      persist(conv);
      // feature 009: regenerated turns reuse the original attachments —
      // ids re-resolve to the same on-disk content (deterministic)
      const reAtt = buildAttachmentContext(
        userMsg.attachments?.map((a) => a.id),
        userMsg.content,
      );
      streamAssistant(
        conv,
        variant,
        history,
        reAtt?.current ?? userMsg.content,
        reAtt?.plannerText,
      );
      return { messageId: variant.id };
    },
    "chat.edit": ({
      messageId,
      content,
      userMessageId,
    }: {
      messageId: string;
      content: string;
      userMessageId?: string;
    }) => {
      const text = content.trim();
      if (!text) fail("EMPTY_MESSAGE", "message must not be empty");
      if (turnBusy()) {
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
      // feature 005: edit creates a user sibling + fresh assistant child;
      // the original subtree stays reachable (deleteMessagesAfter leaves
      // the edit path — kept exported for tests/cleanup)
      const history = turnsBefore(conv, msg);
      const userVariant: Message = {
        id: userMessageId ?? newId(),
        conversationId: conv.id,
        role: "user",
        content: text,
        status: "complete",
        createdAt: now(),
        completedAt: now(),
        parentId: msg.parentId ?? null,
      };
      const assistantMsg: Message = {
        id: newId(),
        conversationId: conv.id,
        role: "assistant",
        content: "",
        status: "generating",
        createdAt: now(),
        completedAt: null,
        parentId: userVariant.id,
      };
      conv.messages.push(userVariant, assistantMsg);
      conv.activeLeaf = assistantMsg.id;
      conv.updatedAt = now();
      persist(conv);
      streamAssistant(conv, assistantMsg, history, text);
      return { messageId: assistantMsg.id };
    },
    "message.selectVariant": ({ messageId }: { messageId: string }) => {
      if (turnBusy()) {
        fail("ENGINE_BUSY", "a generation is already in progress");
      }
      const found = findMessage(messageId);
      if (!found) {
        fail("NOT_FOUND", `message ${messageId} not found`);
      }
      const { conv, msg } = found;
      conv.activeLeaf = deepestLeaf(conv, msg).id;
      conv.updatedAt = now();
      persist(conv);
      return { activeLeaf: conv.activeLeaf };
    },
    "chat.stop": ({ messageId }: { messageId: string }) => {
      if (activeMessageId !== messageId) {
        fail("NOT_GENERATING", "no generation is active for that message");
      }
      // engine may not have started yet (load/prefill) — flag it so the
      // earliest observable point in run()/onToken turns it into partial
      pendingStop = messageId;
      // feature 015: a pending tool approval resolves as discarded
      tools().discardPending(messageId);
      deps.engine.stop();
      return {};
    },
    // feature 015: decision on a pending tool call
    "tool.respond": ({
      callId,
      decision,
    }: {
      callId: string;
      decision: "approve" | "deny" | "allowSession";
    }) => {
      if (!tools().respond(callId, decision)) {
        fail("NOT_FOUND", `no pending tool call ${callId}`);
      }
      return {};
    },
    // feature 015: sandbox-root folder picker; null = cancelled
    "tool.pickRoot": async () => {
      const path = (await deps.dialogs?.pickFolder()) ?? null;
      return { path };
    },
    // feature 013: auto-update (contracts/rpc.md). manual=true surfaces
    // errors; launch checks run manual=false and degrade silently.
    "update.check": async ({ manual }: { manual?: boolean }) => {
      const u = deps.updater;
      if (!u) fail("UPDATE_DISABLED", "Update service unavailable");
      return updateCall(() => u.check(manual === true));
    },
    "update.download": async () => {
      const u = deps.updater;
      if (!u) fail("UPDATE_DISABLED", "Update service unavailable");
      return updateCall(() => u.download());
    },
    "update.apply": async () => {
      const u = deps.updater;
      if (!u) fail("UPDATE_DISABLED", "Update service unavailable");
      await updateCall(() => u.apply());
      return {};
    },
    "update.state": () => deps.updater?.state() ?? { ...IDLE_UPDATE_VIEW },
    "settings.get": () => {
      const s = deps.store.getSettings();
      return {
        generation: s.generation,
        modelOverrides: s.modelOverrides,
        // feature 016: default off
        outputPanel: s.outputPanel ?? false,
        // feature 015: default {root: null, mode: deny} = inactive
        tools: s.tools ?? { sandboxRoot: null, mode: "deny" },
        // feature 021: absent → "system"
        themeMode: s.themeMode ?? "system",
        // feature 013: reports the stored pref (env kill-switch affects
        // behavior, not this field); channel default = installed channel
        updates: {
          enabled: s.updates?.enabled ?? true,
          channel:
            s.updates?.channel ?? deps.updater?.preferredChannel() ?? "canary",
        },
      };
    },
    "settings.set": ({
      generation,
      modelOverride,
      outputPanel,
      tools: toolsPatch,
      themeMode,
      resolvedTheme: resolvedPatch,
      updates: updatesPatch,
    }: {
      generation?: Partial<GenerationParams>;
      outputPanel?: boolean;
      modelOverride?: {
        fileName: string;
        params: Partial<GenerationParams> | null;
      };
      tools?: Partial<import("../../shared/types").ToolPolicy>;
      themeMode?: import("../../shared/types").ThemeMode;
      resolvedTheme?: "light" | "dark";
      updates?: { enabled?: boolean; channel?: UpdateChannel };
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
      if (outputPanel !== undefined) next.outputPanel = outputPanel;
      if (themeMode !== undefined) {
        if (themeMode !== "light" && themeMode !== "dark" && themeMode !== "system") {
          fail("INVALID_PARAMS", `unknown theme mode: ${themeMode}`);
        }
        next.themeMode = themeMode;
      }
      if (
        resolvedPatch !== undefined &&
        resolvedPatch !== resolvedTheme
      ) {
        resolvedTheme = resolvedPatch;
        deps.views?.pushTheme({ mode: resolvedTheme, vars: {} });
      }
      if (toolsPatch) {
        // feature 015: merge into existing policy; a set root must be an
        // existing directory, mode must be a known value
        const cur = s.tools ?? { sandboxRoot: null, mode: "deny" as const };
        const merged = { ...cur, ...toolsPatch };
        if (
          merged.mode !== "ask" &&
          merged.mode !== "allow-read-session" &&
          merged.mode !== "deny"
        ) {
          fail("INVALID_PARAMS", `unknown tool mode: ${merged.mode}`);
        }
        if (merged.sandboxRoot !== null) {
          try {
            if (!statSync(merged.sandboxRoot).isDirectory()) {
              fail("INVALID_PARAMS", "sandbox root is not a directory");
            }
          } catch (e) {
            if (e instanceof EngineError) throw e;
            fail("INVALID_PARAMS", "sandbox root does not exist");
          }
        }
        next.tools = merged;
      }
      if (modelOverride) {
        if (modelOverride.params === null) {
          delete next.modelOverrides[modelOverride.fileName];
        } else {
          next.modelOverrides[modelOverride.fileName] = {
            ...next.modelOverrides[modelOverride.fileName],
            ...modelOverride.params,
          };
        }
      }
      if (updatesPatch) {
        if (
          updatesPatch.channel !== undefined &&
          updatesPatch.channel !== "stable" &&
          updatesPatch.channel !== "canary"
        ) {
          fail("INVALID_PARAMS", `unknown update channel: ${updatesPatch.channel}`);
        }
        next.updates = {
          enabled: s.updates?.enabled ?? true,
          // default = installed channel, not a hardcoded one (FR-006)
          channel:
            s.updates?.channel ?? deps.updater?.preferredChannel() ?? "canary",
          ...(updatesPatch.enabled !== undefined
            ? { enabled: updatesPatch.enabled }
            : {}),
          ...(updatesPatch.channel !== undefined
            ? { channel: updatesPatch.channel }
            : {}),
        };
      }
      deps.store.saveSettings(next);
      return {};
    },
    // feature 016
    "metrics.list": () => ({ entries: deps.metrics?.list() ?? [] }),
    "metrics.clear": () => deps.metrics?.clear() ?? { removed: 0 },
    // feature 017: extension packs. dialogs.pickFolder/pickFile resolve
    // empty paths on folder/archive sources; null = cancelled.
    "extension.scan": () => ({ packs: extStore().scan() }),
    "extension.install": async ({ source }: { source: PackSource }) => {
      const exts = extStore();
      const src = { ...source } as typeof source;
      if ((src.kind === "folder" && !src.path) || (src.kind === "archive" && !src.path)) {
        const picked =
          src.kind === "folder"
            ? await deps.dialogs?.pickFolder()
            : await deps.dialogs?.pickFile("tgz,tar,gz");
        if (!picked) return { pack: null };
        (src as { path: string }).path = picked;
      }
      const pack = await exts.install(src);
      deps.emit("extension.changed", { pack });
      return { pack };
    },
    "extension.preview": async ({ source }: { source: PackSource }) => {
      const exts = extStore();
      const src = { ...source } as typeof source;
      if ((src.kind === "folder" && !src.path) || (src.kind === "archive" && !src.path)) {
        const picked =
          src.kind === "folder"
            ? await deps.dialogs?.pickFolder()
            : await deps.dialogs?.pickFile("tgz,tar,gz");
        if (!picked) fail("INVALID_PARAMS", "no source selected");
        (src as { path: string }).path = picked;
      }
      return exts.preview(src);
    },
    "extension.enable": ({ packId, consent }: { packId: string; consent?: boolean }) => {
      const pack = extStore().enable(packId, consent === true);
      deps.emit("extension.changed", { pack });
      return { pack };
    },
    "extension.disable": ({ packId }: { packId: string }) => {
      const pack = extStore().disable(packId);
      deps.emit("extension.changed", { pack });
      return { pack };
    },
    "extension.remove": ({ packId, purgeData }: { packId: string; purgeData?: boolean }) => {
      extStore().remove(packId, purgeData === true);
      deps.emit("extension.changed", {
        pack: {
          id: packId,
          dir: "",
          state: "disabled",
          source: { kind: "folder", ref: "" },
          manifest: { name: packId, version: "", apiLevel: 0, capabilities: [], contributions: {} },
          installedAt: 0,
        },
      });
      return { removed: true as const };
    },
    "pack.contributions": ({ packId }: { packId: string }) => {
      const pack = extStore().get(packId); // PACK_NOT_FOUND when absent
      const c = contribReg.contributions(packId) ?? {
        skills: [], pipelines: [], agents: [], views: [], commands: [],
      };
      // manifest-declared views + commands merge with registry content
      return {
        ...c,
        views: pack.manifest.contributions.views ?? [],
        commands: pack.manifest.contributions.commands ?? [],
      };
    },
    "pack.readSpec": ({ contributionId }: { contributionId: string }) => {
      const spec = contribReg.readSpec(contributionId);
      if (!spec) {
        fail("CONTRIBUTION_NOT_FOUND", `no contribution "${contributionId}"`);
      }
      return spec;
    },
    // feature 017: fabric runs — ENGINE_BUSY in both directions (I2)
    "run.start": ({
      packId, target, objective, params, budget,
    }: {
      packId: string;
      target: { kind: "pipeline" | "agent"; id: string };
      objective: string;
      params?: Record<string, unknown>;
      budget?: {
        maxSteps?: number;
        maxDelegations?: number;
        maxModelCalls?: number;
        maxDepth?: number;
      };
    }) => {
      if (!objective || !objective.trim()) {
        fail("INVALID_PARAMS", "objective must be non-empty");
      }
      const pack = extStore().get(packId);
      if (pack.state !== "enabled") {
        fail("PACK_INVALID", `pack "${packId}" is not enabled`);
      }
      if (turnBusy()) {
        fail("ENGINE_BUSY", "model engine is busy (chat turn or run active)");
      }
      const ref = target.id.includes(":") ? target.id : `${packId}:${target.id}`;
      const found =
        target.kind === "pipeline"
          ? contribReg.lookupSkill(ref)?.steps
          : contribReg.lookupAgentContrib(ref);
      if (!found) {
        fail("CONTRIBUTION_NOT_FOUND", `no ${target.kind} "${target.id}" in pack "${packId}"`);
      }
      return {
        runId: fabric.start({ packId, target: { ...target, id: ref }, objective, params, budget }),
      };
    },
    "run.cancel": ({ runId }: { runId: string }) => {
      if (!fabric.cancel(runId)) fail("RUN_NOT_FOUND", `no active run "${runId}"`);
      return { cancelled: true as const };
    },
    "run.list": ({ packId, status }: { packId?: string; status?: string }) => ({
      runs: fabric
        .list(packId)
        .filter((r) => (status ? r.status === status : true)),
    }),
    "run.get": ({ runId }: { runId: string }) => {
      const run = fabric.get(runId);
      if (!run) fail("RUN_NOT_FOUND", `no run "${runId}"`);
      return { run };
    },
    "run.clear": ({ packId }: { packId: string }) => ({
      removed: fabric.clear(packId),
    }),
    // feature 017: extension view sessions (contracts/view-bridge.md)
    "view.open": ({ packId, viewId, slot, rect }: { packId: string; viewId: string; slot?: string; rect?: { x: number; y: number; width: number; height: number } }) => {
      const pack = extStore().get(packId);
      if (pack.state !== "enabled") {
        fail("PACK_INVALID", `pack "${packId}" is not enabled`);
      }
      let sessionId: string | null = null;
      const bridge = createViewBridge(pack, viewId, {
        engine: () => deps.engine,
        runs: () => fabric,
        theme: () => ({ mode: resolvedTheme, vars: {} }),
        startRun: (pid, target, params) =>
          fabric.start({ packId: pid, target: { ...target, id: target.id.includes(":") ? target.id : `${pid}:${target.id}` }, objective: `command:${viewId}`, params }),
        reportError: (message) => {
          if (sessionId) viewMgr().markCrashed(sessionId, message);
        },
      });
      const s = viewMgr().open(pack, viewId, bridge, rect);
      sessionId = s.sessionId;
      // initial theme sync; change pushes go through the same path (FR-015)
      viewMgr().pushTheme({ mode: resolvedTheme, vars: {} });
      void slot;
      return { sessionId: s.sessionId };
    },
    "view.close": ({ sessionId }: { sessionId: string }) => {
      viewMgr().close(sessionId);
      return {};
    },
    "view.setBounds": ({ sessionId, rect }: { sessionId: string; rect: { x: number; y: number; width: number; height: number } }) => {
      viewMgr().setBounds(sessionId, rect);
      return {};
    },
    "view.setVisible": ({ sessionId, visible }: { sessionId: string; visible: boolean }) => {
      viewMgr().setVisible(sessionId, visible);
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
          ...next.modelOverrides[fileName],
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
        mode: "single",
        plannerTag: "planner",
        executorTag: "executor",
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
      const conv = deps.store.getConversation(conversationId);
      if (!deps.store.deleteConversation(conversationId)) {
        fail("NOT_FOUND", `conversation ${conversationId} not found`);
      }
      if (conv) gcFor(conv); // feature 009: unlink attachment files
      return {};
    },
    // feature 006: per-conversation persona assignment. Null clears.
    // suggestedTag lets the renderer offer to re-bind (never automatic).
    "conversation.setPersona": ({
      conversationId,
      personaName,
    }: {
      conversationId: string;
      personaName: string | null;
    }) => {
      const conv = deps.store.getConversation(conversationId);
      if (!conv) fail("NOT_FOUND", `conversation ${conversationId} not found`);
      const persona = personaName ? personasSvc().get(personaName) : null;
      if (personaName && !persona) {
        fail("NOT_FOUND", `persona "${personaName}" not found`);
      }
      conv.personaName = persona?.name ?? null;
      conv.updatedAt = now();
      persist(conv);
      return persona?.preferredTag
        ? { suggestedTag: persona.preferredTag }
        : {};
    },
    // feature 006: persona + snippet CRUD (settings-resident)
    "persona.list": () => ({ personas: personasSvc().list() }),
    "persona.upsert": ({ persona }: { persona: Persona }) => ({
      persona: personasSvc().upsert(persona),
    }),
    "persona.delete": ({ name }: { name: string }) =>
      personasSvc().delete(name),
    "persona.usage": ({ name }: { name: string }) => personasSvc().usage(name),
    "snippet.list": () => ({ snippets: personasSvc().snippets() }),
    "snippet.upsert": ({ snippet }: { snippet: Snippet }) => ({
      snippet: personasSvc().upsertSnippet(snippet),
    }),
    "snippet.delete": ({ name }: { name: string }) => ({
      deleted: personasSvc().deleteSnippet(name),
    }),
    // feature 007: best-effort search — malformed/short queries degrade
    // to empty groups rather than INVALID_PARAMS
    "search.query": ({ q }: { q: string }) => searchIndex().query(q),
    // feature 010 (US2): snapshot storage surface
    "snapshot.stats": () =>
      snapSync()?.stats() ?? { count: 0, usedBytes: 0, maxBytes: 0 },
    "snapshot.clear": () =>
      snapSync()?.clear() ?? { removed: 0, freedBytes: 0 },
    // feature 008: export/import — dialogs are injectable (deps.dialogs);
    // absent dep = treat as cancelled, so headless tests stay safe
    "conversation.export": async ({
      conversationId,
      format,
    }: {
      conversationId: string;
      format: "markdown" | "json";
    }) => {
      if (format !== "markdown" && format !== "json") {
        fail("INVALID_PARAMS", `invalid format: ${format}`);
      }
      const conv = deps.store.getConversation(conversationId);
      if (!conv) fail("NOT_FOUND", `conversation ${conversationId} not found`);
      const dir = await deps.dialogs?.pickFolder();
      if (!dir) return { path: null };
      const ext = format === "json" ? "json" : "md";
      const name = uniqueFileName(conv.title, conv.id, ext, (n) =>
        existsSync(join(dir, n)),
      );
      const path = join(dir, name);
      writeFileSync(
        path,
        format === "json"
          ? JSON.stringify(buildEnvelope(conv), null, 2)
          : renderMarkdown(conv),
        "utf8",
      );
      return { path };
    },
    "conversation.import": async () => {
      const file = await deps.dialogs?.pickFile("json");
      if (!file) return { conversationId: null };
      const env = parseEnvelope(readFileSync(file, "utf8"));
      if (env.kind !== "conversation") {
        fail("INVALID_PARAMS", "expected a conversation export file");
      }
      const titles = new Set(
        deps.store.listConversations().map((c) => c.title),
      );
      let first: string | null = null;
      for (const ec of env.conversations) {
        const r = remapConversation(ec, titles.has(ec.title));
        titles.add(r.title);
        deps.store.saveConversation(r);
        first ??= r.id;
      }
      return { conversationId: first };
    },
    "backup.export": async () => {
      const dir = await deps.dialogs?.pickFolder();
      if (!dir) return { path: null };
      const convs = deps.store
        .listConversations()
        .map((s) => deps.store.getConversation(s.id))
        .filter((c): c is Conversation => c !== null);
      const settings = deps.store.getSettings();
      const env = buildBackupEnvelope(convs, settings, settings.tags);
      const name = uniqueFileName("backup", crypto.randomUUID(), "json", (n) =>
        existsSync(join(dir, n)),
      );
      const path = join(dir, name);
      writeFileSync(path, JSON.stringify(env, null, 2), "utf8");
      return { path };
    },
    "backup.import": async () => {
      const file = await deps.dialogs?.pickFile("json");
      if (!file) return { imported: null };
      const env = parseEnvelope(readFileSync(file, "utf8"));
      if (env.kind !== "backup") {
        fail("INVALID_PARAMS", "expected a backup export file");
      }
      const titles = new Set(
        deps.store.listConversations().map((c) => c.title),
      );
      for (const ec of env.conversations) {
        const r = remapConversation(ec, titles.has(ec.title));
        titles.add(r.title);
        deps.store.saveConversation(r);
      }
      if (env.settings) {
        const current = deps.store.getSettings();
        // keep local-only tags too (they act as the provisioned set)
        deps.store.saveSettings(
          toSettings(env.settings, env.tags ?? [], modelsDir(), current.tags),
        );
      }
      return { imported: env.conversations.length };
    },
    "role.list": () => ({ tags: rolesSvc().list() }),
    "role.create": ({
      name,
      label,
      description,
    }: {
      name: string;
      label?: string;
      description?: string;
    }) => {
      const tag = rolesSvc().create({ name, label, description });
      deps.emit("role.changed", { name });
      return { tag };
    },
    "role.update": ({
      name,
      label,
      description,
      params,
    }: {
      name: string;
      label?: string;
      description?: string;
      params?: Partial<GenerationParams> | null;
    }) => {
      rolesSvc().update({ name, label, description, params });
      deps.emit("role.changed", { name });
      return {};
    },
    "role.delete": ({ name, force }: { name: string; force?: boolean }) => {
      rolesSvc().delete(name, force ?? false);
      deps.emit("role.changed", { name });
      return {};
    },
    "role.bind": ({
      name,
      fileName,
    }: {
      name: string;
      fileName: string | null;
    }) => {
      rolesSvc().bind(name, fileName);
      deps.emit("role.changed", { name });
      return {};
    },
    "role.setFallback": ({
      name,
      chain,
    }: {
      name: string;
      chain: RoleRef[];
    }) => {
      rolesSvc().setFallback(name, chain);
      deps.emit("role.changed", { name });
      return {};
    },
    "role.resolve": ({ name }: { name: string }) => {
      const candidates = rolesSvc().resolveCandidates(name);
      if (candidates.length === 0) {
        fail("ROLE_UNBOUND", `role "${name}" has no bound model`);
      }
      return { resolved: candidates[0]!, candidates };
    },
    "conversation.setMode": ({
      conversationId,
      mode,
      plannerTag,
      executorTag,
    }: {
      conversationId: string;
      mode: "single" | "fusion";
      plannerTag?: string;
      executorTag?: string;
    }) => {
      const conv = deps.store.getConversation(conversationId);
      if (!conv) fail("NOT_FOUND", `conversation ${conversationId} not found`);
      if (mode !== "single" && mode !== "fusion") {
        fail("INVALID_PARAMS", `invalid mode: ${mode}`);
      }
      const pTag = plannerTag ?? conv.plannerTag;
      const eTag = executorTag ?? conv.executorTag;
      if (mode === "fusion" && deps.roles) {
        requireBound("planner", pTag);
        requireBound("executor", eTag);
      }
      conv.mode = mode;
      conv.plannerTag = pTag;
      conv.executorTag = eTag;
      conv.updatedAt = now();
      persist(conv);
      return {};
    },
  };
}

export type RequestHandlers = ReturnType<typeof createRequestHandlers>;

// feature 010: lazily-built singleton (kvDir under APP_DATA_DIR in
// tests, userData in prod); policy synced per access in createRequestHandlers
let snapStore: SnapshotStore | null = null;
function snapshotStore(): SnapshotStore {
  snapStore ??= new SnapshotStore();
  return snapStore;
}

// feature 016: session-scoped ring, lazily built
let metricStore: MetricsStore | null = null;
function metricsStore(): MetricsStore {
  metricStore ??= new MetricsStore();
  return metricStore;
}

const registry = new ModelRegistry(undefined, undefined, (slot) =>
  // FR-008: offer the evicted slot's resident KV to disk before free
  slot.engine.saveState?.(snapshotStore()),
);
const roles = new RolesService({ store });
const personas = new PersonaService({
  store,
  tagNames: () => roles.list().map((t) => t.name),
  getConversation: (id) => store.getConversation(id),
  saveConversation: (c) => store.saveConversation(c),
});
const engine = createRegistryEngine({
  registry,
  activePath: () => store.getSettings().activeModelPath,
});

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

// Linux/GTK: Utils.openFileDialog is a synchronous FFI call that can hang
// the entire main proc (observed under Wayland: launcher spins at 100% CPU
// and every RPC then times out). zenity runs out-of-process so a stuck or
// cancelled dialog can never block the event loop. Returns undefined when
// zenity can't spawn at all (→ native fallback), null on cancel.
async function zenityPick(
  mode: "dir" | "file" | "files",
  types: string,
): Promise<string[] | null | undefined> {
  try {
    const args = [
      "zenity",
      "--file-selection",
      `--title=Select ${mode === "dir" ? "folder" : "file"}`,
    ];
    if (mode === "dir") args.push("--directory");
    if (mode === "files") args.push("--multiple", "--separator=\n");
    if (types !== "*") {
      const exts = types.split(",").map((t) => `*.${t.trim()}`).join(" ");
      args.push("--file-filter", `Supported | ${exts}`, "--file-filter", "All files | *");
    }
    const proc = Bun.spawn(args, { stdout: "pipe", stderr: "ignore" });
    const out = (await new Response(proc.stdout).text()).trim();
    if ((await proc.exited) !== 0 || !out) return null;
    return out.split("\n").filter(Boolean);
  } catch {
    return undefined;
  }
}

const useZenity =
  process.platform === "linux" && process.env.AI_DESKTOP_NATIVE_DIALOGS !== "1";

async function nativeDialog(dir: boolean, types: string, multi: boolean) {
  const { Utils } = await import("electrobun/main");
  return Utils.openFileDialog({
    startingFolder: "~/",
    allowedFileTypes: types,
    canChooseFiles: !dir,
    canChooseDirectory: dir,
    allowsMultipleSelection: multi,
  });
}

function makeDialogs() {
  return {
    pickFolder: async () => {
      const z = useZenity ? await zenityPick("dir", "*") : undefined;
      if (z !== undefined) return z?.[0] ?? null;
      return (await nativeDialog(true, "*", false))[0] ?? null;
    },
    pickFile: async (types = "*") => {
      const z = useZenity ? await zenityPick("file", types) : undefined;
      if (z !== undefined) return z?.[0] ?? null;
      return (await nativeDialog(false, types, false))[0] ?? null;
    },
    pickFiles: async (types = "*") => {
      const z = useZenity ? await zenityPick("files", types) : undefined;
      if (z !== undefined) return z;
      const r = await nativeDialog(false, types, true);
      return r.length ? r : null;
    },
  };
}

export function createRpc(getHost?: () => HostTarget | null) {
  // oxlint-disable-next-line consistent-function-scoping -- placeholder reassigned below
  let emit: Emit = () => {};
  // feature 013: wraps the devkit Updater singleton; emits update.status
  // through the same transport once the webview attaches
  const updater = new UpdateService({
    updater: Updater,
    getSettings: () => store.getSettings(),
    emit: (m, p) => emit(m, p),
  });
  // feature 022: first-run bootstrap — reuses the shared download core,
  // binds to the provisioned "default" role, loads via the same
  // bootstrapModel path as a configured model
  const setup = new SetupService({
    hasUsableModel: () => {
      const path = store.getSettings().activeModelPath;
      return scanModels().length > 0 || (path !== null && existsSync(path));
    },
    download: (onEvent) =>
      downloadGguf(DEFAULT_MODEL.url, DEFAULT_MODEL.fileName, modelsDir(), onEvent),
    bindDefault: (fileName) => {
      roles.bind("default", fileName);
      emit("role.changed", { name: "default" });
    },
    load: () => bootstrapModel(emit),
    emit: (s) => emit("setup.status", s),
  });
  const handlers = createRequestHandlers({
    engine,
    roles,
    registry,
    personas,
    setup,
    snapshots: snapshotStore(),
    metrics: metricsStore(),
    emit: (m, p) => emit(m, p),
    store,
    updater,
    viewFactory: electrobunViewFactory(getHost ?? (() => null)),
    dialogs: makeDialogs(),
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
  const start = () => {
    // feature 022: runs before bootstrapModel on purpose — when nothing
    // is configured the download is what eventually binds+loads the
    // model; with a configured path setup short-circuits to "done" and
    // bootstrapModel still performs the load as before
    void setup.run();
    void bootstrapModel(emit);
    // feature 013: launch check — fire-and-forget, never blocks startup;
    // non-manual so failures degrade silently (FR-001/FR-007, SC-001)
    void updater.check(false).catch(() => {});
  };
  return { rpc, start };
}

export { engine };
