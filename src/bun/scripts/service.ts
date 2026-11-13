// feature 023: ScriptService (research D5/D6/D9). Registry CRUD,
// policy + session grants (mirroring ToolService's in-memory grants),
// declared-param validation, workdir lifecycle, and the single
// execution entry every caller shares (chat loop, manual run,
// pipeline step).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  ScriptEntry,
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
import { isValidSlug, slugify, type ScriptStore } from "./store";
import { recordAudit } from "../tools/audit";
import { scriptRunsDir } from "../store/paths";

export const DEFAULT_SCRIPT_TIMEOUT = 30_000;
export const MAX_SCRIPT_TIMEOUT = 300_000;
const CAPTURE_CAP = 256 * 1024; // stored stdout/stderr bound
const TRUNC_MARK = "\n…[truncated]";

export type ScriptDecision = "approve" | "deny" | "allowSession" | "discard";

const cap = (s: string): string =>
  s.length > CAPTURE_CAP ? s.slice(0, CAPTURE_CAP) + TRUNC_MARK : s;

interface PendingCall {
  callId: string;
  ns: string; // consent namespace: conversationId or runId
  resolve: (d: ScriptDecision) => void;
}

export class ScriptService {
  private grants = new Map<string, true>(); // ns -> allow-session
  private pending = new Map<string, PendingCall>();
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

  awaitDecision(callId: string, ns: string): Promise<ScriptDecision> {
    return new Promise((resolve) => {
      this.pending.set(callId, { callId, ns, resolve });
    });
  }

  respond(callId: string, decision: Exclude<ScriptDecision, "discard">): boolean {
    const p = this.pending.get(callId);
    if (!p) return false;
    this.pending.delete(callId);
    if (decision === "allowSession") this.grantSession(p.ns);
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
    }));
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
    } else if (entry.source.kind === "external" && !entry.source.path) {
      throw new EngineError("INVALID_PARAMS", "external source needs a path");
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
      throw new EngineError(
        "SCRIPT_NOT_FOUND",
        `source for "${entry.id}" is unavailable`,
      );
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
        new EngineError("ENGINE_ERROR", `script run failed`),
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
    opts: { initiator: ScriptInitiator; conversationId?: string; messageId?: string; callId?: string },
    rec: ScriptRunRecord,
    started: number,
  ): void {
    if (!opts.conversationId || !opts.messageId || !opts.callId) return;
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
    });
  }

  async resetRuntime(kind: ScriptRuntimeKind): Promise<void> {
    await this.deps.sessions.reset(kind);
  }

  async dispose(): Promise<void> {
    await this.deps.sessions.dispose();
  }
}
