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
  ResolvedRole,
  RoleRef,
} from "../../shared/types";
import { DEFAULT_GENERATION } from "../../shared/types";
import { EngineError } from "../llama/engine";
import { mergeParams, validateParams } from "../llama/params";
import { buildPrompt, type PromptTurn } from "../llama/prompt";
import { modelsDir, scanModels } from "../models/library";
import { ModelRegistry, createRegistryEngine } from "../models/registry";
import { RolesService } from "../models/roles";
import { runFusionTurn } from "../llama/fusion";
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
  deepestLeaf,
  leafOf,
  parentOf,
  pathOf,
  pathToLeaf,
} from "../store/tree";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

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
  // feature 004: optional so existing tests keep a two-dep harness
  roles?: RolesService;
  registry?: ModelRegistry;
  // feature 008: file pickers, injectable for headless tests
  dialogs?: {
    pickFolder(): Promise<string | null>;
    pickFile(allowedTypes?: string): Promise<string | null>;
  };
}

function fail(code: RpcErrorCode, message: string): never {
  throw new EngineError(code, message);
}

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

  const rolesSvc = () => deps.roles ?? new RolesService({ store: deps.store });

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
  const streamAssistant = (
    conv: Conversation,
    assistantMsg: Message,
    history: PromptTurn[],
    current: string,
  ): void => {
    // FR-010: single-mode generation resolves through the `default` tag;
    // when the roles dep is absent (unit-test harness) fall back to the
    // legacy per-model param merge.
    // candidate list for the runtime fallback cascade (T019); legacy
    // test harness without roles dep gets a single implicit candidate
    let candidates: ResolvedRole[] = [];
    if (deps.roles) {
      try {
        candidates = deps.roles.resolveCandidates("default");
      } catch {
        candidates = [];
      }
    }
    const legacyGenParams = resolveGenParams();
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
      // fusion mode: two-phase planner -> executor via the orchestrator
      if (conv.mode === "fusion" && deps.roles && deps.registry) {
        const planner = deps.roles.resolveCandidates(conv.plannerTag);
        const executor = deps.roles.resolveCandidates(conv.executorTag);
        if (planner.length === 0) {
          fail("ROLE_UNBOUND", `planner role "${conv.plannerTag}" has no bound model`);
        }
        if (executor.length === 0) {
          fail("ROLE_UNBOUND", `executor role "${conv.executorTag}" has no bound model`);
        }
        const res = await runFusionTurn({
          planner,
          executor,
          registry: deps.registry,
          conversationId: conv.id,
          history,
          current,
          onTruncated: warnTruncated,
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
          let budget = baseBudget;
          for (;;) {
            const built = buildPrompt(history, current, {
              chatml,
              budget,
              costOf,
            });
            if (built.truncated) warnTruncated();
            try {
              // oxlint-disable-next-line no-await-in-loop -- sequential budget-halving retry
              const r = await eng.generate(
                built.prompt,
                (delta) => {
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
                  dirty = true;
                  deps.emit("chat.token", { messageId, delta });
                },
                genParams,
                { conversationId: conv.id },
              );
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
              if (!isCtxOverflow(e) || budget <= 256) throw e;
              budget = Math.floor(budget / 2);
            }
          }
        } catch (e) {
          lastErr = e;
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
    "model.load": async ({ path }: { path: string }) => {
      deps.emit("model.progress", { phase: "loading" });
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
    "model.download": ({
      url,
      fileName,
      tagName,
    }: {
      url: string;
      fileName: string;
      tagName?: string;
    }) => {
      // allowlist: huggingface.co/<org>/<repo>/resolve/<rev>/<file>.gguf
      const HF_RE =
        /^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[^\s/]+\/[^\s/]+\.gguf(?:\?[^\s]*)?$/;
      if (!HF_RE.test(url)) {
        fail(
          "INVALID_URL",
          "only https://huggingface.co/<org>/<repo>/resolve/<rev>/<file>.gguf links are allowed",
        );
      }
      const safeName = basename(fileName.trim());
      if (!safeName.endsWith(".gguf") || safeName !== fileName.trim()) {
        fail("INVALID_URL", "fileName must be a plain .gguf basename");
      }
      // validate the tag exists before the download starts (FR-004)
      if (tagName !== undefined) {
        const known = rolesSvc()
          .list()
          .some((t) => t.name === tagName);
        if (!known) fail("NOT_FOUND", `role tag not found: ${tagName}`);
      }
      const dir = modelsDir();
      mkdirSync(dir, { recursive: true });
      const target = join(dir, safeName);
      const part = target + ".part";
      if (existsSync(target) || existsSync(part)) {
        fail("ALREADY_EXISTS", `${safeName} already exists`);
      }

      void (async () => {
        let writer: ReturnType<ReturnType<typeof Bun.file>["writer"]> | null =
          null;
        try {
          const res = await fetch(url, { redirect: "follow" });
          if (!res.ok || !res.body) {
            throw new Error(`HTTP ${res.status}`);
          }
          const totalHeader = res.headers.get("content-length");
          const total = totalHeader ? Number(totalHeader) : null;
          writer = Bun.file(part).writer();
          let downloaded = 0;
          let lastEmit = 0;
          const body = res.body as unknown as AsyncIterable<Uint8Array>;
          for await (const chunk of body) {
            writer.write(chunk);
            downloaded += chunk.byteLength;
            if (downloaded - lastEmit >= 4 * 1024 * 1024) {
              lastEmit = downloaded;
              deps.emit("model.download", {
                fileName: safeName,
                phase: "progress",
                downloadedBytes: downloaded,
                totalBytes: total,
              });
            }
          }
          await writer.end();
          writer = null;
          renameSync(part, target);
          deps.emit("model.download", {
            fileName: safeName,
            phase: "done",
            downloadedBytes: downloaded,
            totalBytes: downloaded,
          });
          // FR-004: bind only after the file lands; .part/error never bind
          if (tagName !== undefined) {
            try {
              rolesSvc().bind(tagName, safeName);
              deps.emit("role.changed", { name: tagName });
            } catch {
              // file downloaded; binding failure surfaces on next role.list
            }
          }
        } catch (e) {
          try {
            writer?.end();
          } catch {
            // writer may already be closed
          }
          try {
            unlinkSync(part);
          } catch {
            // .part may not exist yet
          }
          deps.emit("model.download", {
            fileName: safeName,
            phase: "error",
            downloadedBytes: 0,
            totalBytes: null,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      })();
      return { fileName: safeName };
    },
    "chat.send": ({
      conversationId,
      content,
      userMessageId,
      mode,
      plannerTag,
      executorTag,
    }: {
      conversationId: string;
      content: string;
      userMessageId?: string;
      mode?: "single" | "fusion";
      plannerTag?: string;
      executorTag?: string;
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
      const userMsg: Message = {
        id: userMessageId ?? newId(),
        conversationId,
        role: "user",
        content: text,
        status: "complete",
        createdAt: now(),
        completedAt: now(),
        parentId: leaf?.id ?? null,
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
      streamAssistant(conv, variant, history, userMsg.content);
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
      if (deps.engine.isGenerating()) {
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
            ...next.modelOverrides[modelOverride.fileName],
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
      if (!deps.store.deleteConversation(conversationId)) {
        fail("NOT_FOUND", `conversation ${conversationId} not found`);
      }
      return {};
    },
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

const registry = new ModelRegistry();
const roles = new RolesService({ store });
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

export function createRpc() {
  // oxlint-disable-next-line consistent-function-scoping -- placeholder reassigned below
  let emit: Emit = () => {};
  const handlers = createRequestHandlers({
    engine,
    roles,
    registry,
    emit: (m, p) => emit(m, p),
    store,
    dialogs: {
      pickFolder: async () => {
        const { Utils } = await import("electrobun/main");
        const r = await Utils.openFileDialog({
          startingFolder: "~/",
          canChooseFiles: false,
          canChooseDirectory: true,
          allowsMultipleSelection: false,
        });
        return r[0] ?? null;
      },
      pickFile: async (types = "*") => {
        const { Utils } = await import("electrobun/main");
        const r = await Utils.openFileDialog({
          startingFolder: "~/",
          allowedFileTypes: types,
          canChooseFiles: true,
          canChooseDirectory: false,
          allowsMultipleSelection: false,
        });
        return r[0] ?? null;
      },
    },
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
