// feature 023: ScriptService (research D5/D6/D9). Registry CRUD,
// policy + session grants (mirroring ToolService's in-memory grants),
// declared-param validation, workdir lifecycle, and the single
// execution entry every caller shares (chat loop, manual run,
// pipeline step).
import { mkdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type {
  ScriptEntry,
  ScriptImportCandidate,
  ScriptImportError,
  ScriptImportParams,
  ScriptImportResult,
  ScriptInitiator,
  ScriptListItem,
  ScriptParam,
  ScriptPolicy,
  ScriptRunEvent,
  ScriptRunRecord,
  ScriptRuntimeKind,
  ScriptUpsertParams,
  Settings,
} from "../../shared/types";
import { EngineError } from "../llama/engine";
import { resolveInterpreter, runtimeStatus } from "./runtimes";
import type { SessionManager } from "./session";
import {
  fingerprint,
  isValidSlug,
  normalizeSourcePath,
  slugify,
  type ScriptStore,
} from "./store";
import { recordAudit } from "../tools/audit";
import { scriptRunsDir } from "../store/paths";

export const DEFAULT_SCRIPT_TIMEOUT = 30_000;
export const MAX_SCRIPT_TIMEOUT = 300_000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024; // feature 027 (clarify Q3)
const CAPTURE_CAP = 256 * 1024; // stored stdout/stderr bound
const TRUNC_MARK = "\n…[truncated]";

export type ScriptDecision =
  | "approve"
  | "deny"
  | "allowSession"
  // feature 027: grant THIS script's changed content for the session (FR-018)
  | "approveChangedSession"
  | "discard";

const cap = (s: string): string =>
  s.length > CAPTURE_CAP ? s.slice(0, CAPTURE_CAP) + TRUNC_MARK : s;

interface PendingCall {
  callId: string;
  ns: string; // consent namespace: conversationId or runId
  scriptId?: string; // feature 027: needed for approveChangedSession grants
  resolve: (d: ScriptDecision) => void;
}

export class ScriptService {
  private grants = new Map<string, true>(); // ns -> allow-session
  private pending = new Map<string, PendingCall>();
  // feature 027 (FR-018): per-script "approve changes for this session"
  private changedGrants = new Map<string, Set<string>>(); // ns -> scriptIds
  private sessionCalls = new Map<string, number>(); // rt -> in-flight count? (informational)

  constructor(
    private deps: {
      store: ScriptStore;
      sessions: SessionManager;
      getSettings(): Settings;
      emitRun(e: ScriptRunEvent): void;
    },
  ) {}

  // ---------- policy ----------

  policy(): ScriptPolicy {
    return { mode: "deny", backend: "auto", ...this.deps.getSettings().scripts };
  }

  runtimes() {
    return (["python", "r"] as const).map((kind) =>
      runtimeStatus(kind, this.policy(), this.deps.sessions.status(kind)),
    );
  }

  private interpreter(kind: ScriptRuntimeKind): string {
    const { path } = resolveInterpreter(kind, this.policy());
    if (!path) {
      throw new EngineError(
        "RUNTIME_NOT_FOUND",
        `no ${kind === "r" ? "R" : "Python"} interpreter found — configure settings.scripts.runtimes.${kind}.path`,
      );
    }
    return path;
  }

  // scripts callable iff policy allows AND the script's runtime resolves
  scriptsActive(): boolean {
    if (this.policy().mode === "deny") return false;
    return this.runtimes().some((r) => r.status === "ready");
  }

  // ---------- consent (same semantics as ToolService) ----------

  autoApprove(ns: string): boolean {
    return this.policy().mode === "allow-session" || this.grants.has(ns);
  }

  grantSession(ns: string): void {
    this.grants.set(ns, true);
  }

  // feature 027 (R3): what a model/pipeline invocation needs before it may
  // call() — "source-missing" refuses, "ask-changed" prompts with the
  // changed-file variant EVEN under autoApprove (FR-018), "ask" prompts
  // normally, "auto" runs straight through.
  consentState(
    entry: ScriptEntry,
    ns: string,
  ): "auto" | "ask" | "ask-changed" | "source-missing" {
    if (entry.source.kind === "external" && this.sourceState(entry) === "missing") {
      return "source-missing";
    }
    if (entry.source.kind === "external" && !this.changedGrants.get(ns)?.has(entry.id)) {
      const code = this.deps.store.readSource(entry);
      const changed =
        code === null || fingerprint(code) !== entry.approvedFingerprint;
      if (changed) return "ask-changed";
    }
    return this.autoApprove(ns) ? "auto" : "ask";
  }

  awaitDecision(
    callId: string,
    ns: string,
    scriptId?: string,
  ): Promise<ScriptDecision> {
    return new Promise((resolve) => {
      this.pending.set(callId, { callId, ns, scriptId, resolve });
    });
  }

  respond(callId: string, decision: Exclude<ScriptDecision, "discard">): boolean {
    const p = this.pending.get(callId);
    if (!p) return false;
    this.pending.delete(callId);
    if (decision === "allowSession") this.grantSession(p.ns);
    if (decision === "approveChangedSession" && p.scriptId) {
      const set = this.changedGrants.get(p.ns) ?? new Set<string>();
      set.add(p.scriptId);
      this.changedGrants.set(p.ns, set);
    }
    p.resolve(decision);
    return true;
  }

  // turn/run teardown: resolve pending calls for a namespace as discarded
  discardPending(ns: string): void {
    for (const [id, p] of this.pending) {
      if (p.ns === ns) {
        this.pending.delete(id);
        p.resolve("discard");
      }
    }
  }

  // chat.stop: any pending script approval belongs to the in-flight turn
  discardAllPending(): void {
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      p.resolve("discard");
    }
  }

  hasPending(): boolean {
    return this.pending.size > 0;
  }

  // ---------- registry ----------

  list(): ScriptListItem[] {
    const rts = this.runtimes();
    return this.deps.store.list().map((e) => ({
      ...e,
      runtimeStatus:
        rts.find((r) => r.kind === e.runtime)?.status ?? "missing",
      linked: e.source.kind === "external",
      sourceState: this.sourceState(e),
    }));
  }

  // feature 027 (R7): stored sources always "ok" (managed file, written on
  // upsert); external probes readability — same gate readSource applies
  private sourceState(e: ScriptEntry): "ok" | "missing" {
    if (e.source.kind !== "external") return "ok";
    return this.deps.store.readSource(e) === null ? "missing" : "ok";
  }

  get(id: string): ScriptEntry | null {
    return this.deps.store.get(id);
  }

  upsert(p: ScriptUpsertParams): ScriptListItem {
    if (p.runtime !== "python" && p.runtime !== "r") {
      throw new EngineError("INVALID_PARAMS", `unknown runtime ${p.runtime}`);
    }
    const id = p.id ?? slugify(p.name);
    if (!isValidSlug(id)) {
      throw new EngineError(
        "INVALID_PARAMS",
        `script name must be slug-safe (kebab-case), got "${p.name}"`,
      );
    }
    if (p.timeoutMs !== undefined) {
      if (!Number.isFinite(p.timeoutMs) || p.timeoutMs <= 0 || p.timeoutMs > MAX_SCRIPT_TIMEOUT) {
        throw new EngineError(
          "INVALID_PARAMS",
          `timeoutMs must be within (0, ${MAX_SCRIPT_TIMEOUT}]`,
        );
      }
    }
    this.validateParams(p.params ?? []);
    const existing = p.id ? this.deps.store.get(p.id) : this.deps.store.get(id);
    if (p.id && !existing) {
      throw new EngineError("SCRIPT_NOT_FOUND", `no script "${p.id}"`);
    }
    if (!p.id && existing) {
      throw new EngineError(
        "INVALID_PARAMS",
        `a script named "${id}" already exists`,
      );
    }
    const entry: ScriptEntry = {
      id,
      runtime: p.runtime,
      source:
        p.source.kind === "stored"
          ? { kind: "stored" }
          : { kind: "external", path: p.source.path },
      description: p.description ?? existing?.description ?? "",
      params: p.params ?? existing?.params ?? [],
      timeoutMs: p.timeoutMs ?? existing?.timeoutMs,
      enabled: p.enabled ?? existing?.enabled ?? true,
    };
    if (p.source.kind === "stored") {
      this.deps.store.writeSource(id, p.runtime, p.source.text);
      entry.approvedFingerprint = undefined;
    } else if (entry.source.kind === "external") {
      if (!entry.source.path) {
        throw new EngineError("INVALID_PARAMS", "external source needs a path");
      }
      // feature 027 (clarify Q2): the file as typed/picked IS the approved
      // baseline — re-read happens on save so a bad path still persists
      // (surfacing "source missing", not a registry failure)
      const code = this.deps.store.readSource(entry);
      entry.approvedFingerprint = code === null ? undefined : fingerprint(code);
    }
    this.deps.store.upsert(entry);
    return this.list().find((e) => e.id === id)!;
  }

  private validateParams(params: ScriptParam[]): void {
    const seen = new Set<string>();
    for (const prm of params) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(prm.name)) {
        throw new EngineError(
          "INVALID_PARAMS",
          `param name must be an identifier, got "${prm.name}"`,
        );
      }
      if (seen.has(prm.name)) {
        throw new EngineError("INVALID_PARAMS", `duplicate param "${prm.name}"`);
      }
      seen.add(prm.name);
      if (!["text", "number", "json", "bool"].includes(prm.type)) {
        throw new EngineError(
          "INVALID_PARAMS",
          `unknown param type "${prm.type}"`,
        );
      }
    }
  }

  delete(id: string): void {
    if (!this.deps.store.delete(id)) {
      throw new EngineError("SCRIPT_NOT_FOUND", `no script "${id}"`);
    }
  }

  setEnabled(id: string, enabled: boolean): void {
    const e = this.deps.store.get(id);
    if (!e) throw new EngineError("SCRIPT_NOT_FOUND", `no script "${id}"`);
    this.deps.store.upsert({ ...e, enabled });
  }

  // ---------- feature 027: file import + relink (contracts/rpc.md) ----------

  private static extRuntime(path: string): ScriptRuntimeKind | null {
    const ext = extname(path).toLowerCase();
    return ext === ".py" ? "python" : ext === ".r" ? "r" : null;
  }

  // validate one picked file → runtime+text or an error code (FR-013)
  private validateImportFile(
    path: string,
  ): { runtime: ScriptRuntimeKind; path: string; text: string } | { error: ScriptImportError; reason: string } {
    const runtime = ScriptService.extRuntime(path);
    if (!runtime) {
      return { error: "unsupported-ext", reason: "only .py and .r files are accepted" };
    }
    const real = normalizeSourcePath(path);
    if (!real) {
      return { error: "unreadable", reason: "file is missing, unreadable, or not a regular file" };
    }
    let text: string;
    try {
      const buf = readFileSync(real);
      if (buf.length > MAX_IMPORT_BYTES) {
        return { error: "too-large", reason: `file exceeds ${MAX_IMPORT_BYTES / 1024 / 1024} MiB` };
      }
      if (buf.includes(0)) {
        return { error: "invalid-encoding", reason: "file does not look like UTF-8 text" };
      }
      text = buf.toString("utf8");
    } catch {
      return { error: "unreadable", reason: "file could not be read" };
    }
    return { runtime, path: real, text };
  }

  private externalPathOf(e: ScriptEntry): string | null {
    if (e.source.kind !== "external") return null;
    return normalizeSourcePath(e.source.path) ?? e.source.path;
  }

  private uniqueSuggestedId(base: string, taken: Set<string>): string {
    let id = slugify(base) || "script";
    let n = 2;
    while (taken.has(id) || this.deps.store.get(id)) id = `${slugify(base) || "script"}-${n++}`;
    taken.add(id);
    return id;
  }

  // script.pickImport — preview rows for the picked paths (FR-008/009/013/014)
  importCandidates(paths: string[]): ScriptImportCandidate[] {
    const taken = new Set<string>();
    return paths.map((raw) => {
      const fileName = basename(raw);
      const v = this.validateImportFile(raw);
      const suggestedId = this.uniqueSuggestedId(
        fileName.replace(/\.[^.]+$/, ""),
        taken,
      );
      if ("error" in v) {
        return { path: raw, fileName, runtime: "python", suggestedId, error: { code: v.error, reason: v.reason } };
      }
      const dup = this.deps.store
        .list()
        .find((e) => this.externalPathOf(e) === v.path);
      return {
        path: v.path,
        fileName,
        runtime: v.runtime,
        suggestedId,
        duplicateOf: dup?.id,
      };
    });
  }

  // script.import — per-file results; one bad file never aborts (FR-013)
  importFiles(p: ScriptImportParams): ScriptImportResult[] {
    if (!p.files.length || p.files.length > 10) {
      throw new EngineError("INVALID_PARAMS", "import takes 1–10 files");
    }
    return p.files.map(({ path, id }): ScriptImportResult => {
      if (!isValidSlug(id)) {
        return { path, status: "failed", reason: `invalid script id "${id}"` };
      }
      if (this.deps.store.get(id)) {
        return { path, status: "failed", reason: `id "${id}" is already taken` };
      }
      const v = this.validateImportFile(path);
      if ("error" in v) return { path, status: "failed", reason: v.reason };
      const dup = this.deps.store
        .list()
        .find((e) => this.externalPathOf(e) === v.path);
      if (dup) {
        return { path: v.path, status: "duplicate", id: dup.id, reason: `already linked as "${dup.id}"` };
      }
      const entry: ScriptEntry = {
        id,
        runtime: v.runtime,
        source:
          p.mode === "link"
            ? { kind: "external", path: v.path }
            : { kind: "stored" },
        description: "",
        params: [],
        enabled: true,
        approvedFingerprint: p.mode === "link" ? fingerprint(v.text) : undefined,
      };
      if (p.mode === "copy") this.deps.store.writeSource(id, v.runtime, v.text);
      this.deps.store.upsert(entry);
      return { path: v.path, status: "imported", id };
    });
  }

  // script.relink — new file for an external entry; id/settings kept (FR-017)
  relink(id: string, path: string): ScriptListItem {
    const e = this.deps.store.get(id);
    if (!e) throw new EngineError("SCRIPT_NOT_FOUND", `no script "${id}"`);
    if (e.source.kind !== "external") {
      throw new EngineError("INVALID_PARAMS", `script "${id}" is not linked`);
    }
    const runtime = ScriptService.extRuntime(path);
    if (runtime !== e.runtime) {
      throw new EngineError(
        "INVALID_PARAMS",
        `script "${id}" is ${e.runtime} — pick a matching file`,
      );
    }
    const v = this.validateImportFile(path);
    if ("error" in v) {
      throw new EngineError("INVALID_PARAMS", v.reason);
    }
    const next: ScriptEntry = {
      ...e,
      source: { kind: "external", path: v.path },
      approvedFingerprint: fingerprint(v.text),
    };
    this.deps.store.upsert(next);
    return this.list().find((x) => x.id === id)!;
  }

  // ---------- argument validation (FR-006) ----------

  validateArgs(
    entry: ScriptEntry,
    args: Record<string, unknown> | undefined,
    input?: string,
  ): { args: Record<string, unknown>; input?: string } {
    if (entry.params.length === 0) {
      // raw-text form: accept args as `input` or first string value
      const raw = input ?? (args?.input as string | undefined);
      return { args: {}, input: typeof raw === "string" ? raw : undefined };
    }
    const a = args ?? {};
    const declared = new Set(entry.params.map((p) => p.name));
    for (const k of Object.keys(a)) {
      if (!declared.has(k)) {
        throw new EngineError(
          "SCRIPT_INVALID_ARGS",
          `undeclared argument "${k}" for script "${entry.id}"`,
        );
      }
    }
    for (const p of entry.params) {
      const v = a[p.name];
      if (v === undefined || v === null) {
        if (p.required) {
          throw new EngineError(
            "SCRIPT_INVALID_ARGS",
            `missing required argument "${p.name}"`,
          );
        }
        continue;
      }
      const ok =
        (p.type === "text" && typeof v === "string") ||
        (p.type === "number" && typeof v === "number" && Number.isFinite(v)) ||
        (p.type === "bool" && typeof v === "boolean") ||
        p.type === "json";
      if (!ok) {
        throw new EngineError(
          "SCRIPT_INVALID_ARGS",
          `argument "${p.name}" must be ${p.type}`,
        );
      }
    }
    return { args: a };
  }

  // ---------- execution (the one path every caller shares) ----------

  async call(opts: {
    entry: ScriptEntry;
    args?: Record<string, unknown>;
    input?: string;
    initiator: ScriptInitiator;
    ns: string; // consent namespace (conversationId | runId | "manual")
    conversationId?: string;
    messageId?: string;
    callId?: string;
    emitRun?: boolean;
  }): Promise<ScriptRunRecord> {
    const { entry } = opts;
    const code = this.deps.store.readSource(entry);
    if (code === null) {
      // feature 027 (FR-016): linked sources get the distinct missing state
      throw new EngineError(
        entry.source.kind === "external"
          ? "SCRIPT_SOURCE_MISSING"
          : "SCRIPT_NOT_FOUND",
        `source for "${entry.id}" is unavailable`,
      );
    }
    // feature 027: the content actually executed becomes the approved
    // baseline — consent (when required) always precedes call(), and a
    // manual run of a linked file records it as the new baseline (FR-018/019)
    if (entry.source.kind === "external") {
      const fp = fingerprint(code);
      if (fp !== entry.approvedFingerprint) {
        entry.approvedFingerprint = fp;
        this.deps.store.upsert(entry);
      }
    }
    const { args, input } = this.validateArgs(entry, opts.args, opts.input);
    const interpreter = this.interpreter(entry.runtime);
    const runId = crypto.randomUUID();
    const cwd = join(scriptRunsDir(), runId);
    mkdirSync(cwd, { recursive: true });
    const timeoutMs = Math.min(
      entry.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT,
      MAX_SCRIPT_TIMEOUT,
    );
    if (opts.emitRun) {
      this.deps.emitRun({ runId, script: entry.id, phase: "queued" });
      this.deps.emitRun({ runId, script: entry.id, phase: "running" });
    }
    const started = Date.now();
    try {
      const r = await this.deps.sessions.call(entry.runtime, interpreter, {
        runId,
        code,
        args,
        input,
        cwd,
        timeoutMs,
      });
      const rec: ScriptRunRecord = {
        runId,
        script: entry.id,
        initiator: opts.initiator,
        verdict: r.exitStatus === 0 ? "executed" : "error",
        exitStatus: r.exitStatus,
        stdout: cap(r.stdout),
        stderr: cap(r.stderr),
        durationMs: r.durationMs,
        files: r.files,
        sessionRestarted: r.sessionRestarted,
      };
      this.audit(opts, rec, started);
      if (opts.emitRun) {
        this.deps.emitRun({ runId, script: entry.id, phase: rec.verdict === "executed" ? "done" : "error" });
      }
      return rec;
    } catch (e) {
      const rec = this.errorRecord(opts, runId, e, started);
      this.audit(opts, rec, started);
      if (opts.emitRun) {
        this.deps.emitRun({ runId, script: entry.id, phase: "error" });
      }
      throw rec instanceof EngineError ? rec : Object.assign(
        new EngineError(
          "ENGINE_ERROR",
          `script run failed: ${(e as Error).message}`,
        ),
        { record: rec },
      );
    }
  }

  private errorRecord(
    opts: { entry: ScriptEntry; initiator: ScriptInitiator },
    runId: string,
    e: unknown,
    started: number,
  ): ScriptRunRecord {
    const bu = e as { reason?: string; partial?: { stdout: string; stderr: string } };
    const verdict =
      bu.reason === "timeout"
        ? "timeout"
        : bu.reason === "interrupted"
          ? "interrupted"
          : "error";
    return {
      runId,
      script: opts.entry.id,
      initiator: opts.initiator,
      verdict,
      exitStatus: null,
      stdout: cap(bu.partial?.stdout ?? ""),
      stderr: cap(bu.partial?.stderr ?? (e as Error).message),
      durationMs: Date.now() - started,
      files: [],
      sessionRestarted: false,
    };
  }

  private audit(
    opts: { entry: ScriptEntry; initiator: ScriptInitiator; conversationId?: string; messageId?: string; callId?: string },
    rec: ScriptRunRecord,
    started: number,
  ): void {
    recordAudit({
      ts: new Date(started).toISOString(),
      conversationId: opts.conversationId,
      messageId: opts.messageId,
      callId: opts.callId,
      tool: "run_script",
      path: rec.script,
      resolvedPath: join(scriptRunsDir(), rec.runId),
      verdict:
        rec.verdict === "executed"
          ? "executed"
          : rec.verdict === "timeout"
            ? "timeout"
            : rec.verdict === "interrupted"
              ? "interrupted"
              : "error",
      resultBytes: rec.stdout.length,
      error: rec.verdict === "executed" ? undefined : rec.stderr.slice(0, 300),
      script: rec.script,
      initiator: rec.initiator,
      exitStatus: rec.exitStatus,
      durationMs: rec.durationMs,
      sessionRestarted: rec.sessionRestarted,
      // feature 027 (FR-022)
      origin: opts.entry.source.kind === "external" ? "linked" : "stored",
      sourcePath:
        opts.entry.source.kind === "external" ? opts.entry.source.path : undefined,
    });
  }

  async resetRuntime(kind: ScriptRuntimeKind): Promise<void> {
    await this.deps.sessions.reset(kind);
  }

  async dispose(): Promise<void> {
    await this.deps.sessions.dispose();
  }
}
