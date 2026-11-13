// feature 017: run orchestration — executes a pipeline or agent tree as a
// cancellable async task in the main process, streams TraceEntrys to the
// RPC layer, persists RunRecord JSON (50 newest per pack, D8), and
// aborts in-flight runs on pack disable/remove (SC-006).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FabricError } from "./errors";
import type { ComponentEngine, RunCtx } from "./components";
import { executePipeline } from "./pipeline";
import { runAgent } from "./agent";
import type { ContributionRegistry } from "./registry";
import { dataDir, runsDir } from "../store/paths";
import type { Budget, RunRecord, RunStatus, RunSummary, ToolCallRecord, TraceEntry } from "../../shared/types";
import type { ScriptDecision, ScriptService } from "../scripts/service";

export interface RunManagerDeps {
  registry: ContributionRegistry;
  engine: () => ComponentEngine;
  // feature 023: script-backed steps; absent → runtime:"script" skills
  // fail SCRIPT_NOT_FOUND at the step (pack-script.md execution contract)
  scripts?: ScriptService;
  onTrace?: (runId: string, entry: TraceEntry) => void;
  onStatus?: (runId: string, status: RunStatus, error?: { code: string; message: string; path?: string }) => void;
  // pending script consent surfaces like chat tool calls (tool.update)
  onToolCall?: (runId: string, call: ToolCallRecord) => void;
}

const HISTORY_CAP = 50;
const DEFAULT_BUDGET: Required<Budget> = {
  maxSteps: 100,
  maxDelegations: 8,
  maxModelCalls: 32,
  maxDepth: 4,
};

export class RunManager {
  private controllers = new Map<string, AbortController>();
  // in-flight records: run.get must see runs before their first persist
  private live = new Map<string, RunRecord>();
  private seq = 0;

  constructor(private deps: RunManagerDeps) {}

  private persist(rec: RunRecord): void {
    mkdirSync(runsDir(rec.packId), { recursive: true });
    writeFileSync(join(runsDir(rec.packId), `${rec.id}.json`), JSON.stringify(rec, null, 2));
  }

  private prune(packId: string): void {
    const dir = runsDir(packId);
    if (!existsSync(dir)) return;
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).toSorted();
    for (const f of files.slice(0, Math.max(0, files.length - HISTORY_CAP))) {
      rmSync(join(dir, f), { force: true });
    }
  }

  list(packId?: string): RunSummary[] {
    const out: RunSummary[] = [];
    const base = join(dataDir(), "runs");
    const dirs = packId
      ? [runsDir(packId)]
      : existsSync(base)
        ? readdirSync(base, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => join(base, e.name))
        : [];
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
        try {
          const r = JSON.parse(readFileSync(join(dir, file), "utf8")) as RunRecord;
          out.push({
            id: r.id, packId: r.packId, target: r.target,
            objective: r.objective, status: r.status,
            startedAt: r.startedAt, endedAt: r.endedAt,
          });
        } catch { /* torn write — skip */ }
      }
    }
    return out.toSorted((a, b) => b.startedAt - a.startedAt);
  }

  get(runId: string): RunRecord | null {
    const live = this.live.get(runId);
    if (live) return live;
    for (const s of this.list()) {
      if (s.id === runId) {
        try {
          return JSON.parse(readFileSync(join(runsDir(s.packId), `${runId}.json`), "utf8")) as RunRecord;
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  clear(packId: string): number {
    const dir = runsDir(packId);
    if (!existsSync(dir)) return 0;
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    rmSync(dir, { recursive: true, force: true });
    return files.length;
  }

  isRunning(): boolean {
    return this.controllers.size > 0;
  }

  runningFor(packId: string): boolean {
    return [...this.controllers.keys()].some((id) => id.startsWith(`${packId}/`));
  }

  abortPackRuns(packId: string): void {
    for (const [key, c] of this.controllers) {
      if (key.startsWith(`${packId}/`)) c.abort();
    }
  }

  cancel(runId: string): boolean {
    for (const [key, c] of this.controllers) {
      if (key.endsWith(`/${runId}`)) {
        c.abort();
        return true;
      }
    }
    return false;
  }

  // Starts a run in the background; returns its id immediately. Progress
  // flows via deps.onTrace / deps.onStatus.
  start(opts: {
    packId: string;
    target: { kind: "pipeline" | "agent"; id: string };
    objective: string;
    params?: Record<string, unknown>;
    budget?: Budget;
  }): string {
    const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const rec: RunRecord = {
      id: runId,
      packId: opts.packId,
      target: opts.target,
      objective: opts.objective,
      params: opts.params ?? {},
      status: "queued",
      trace: [],
      artifacts: [],
      budget: { ...DEFAULT_BUDGET, ...opts.budget },
      usage: { steps: 0, delegations: 0, modelCalls: 0, promptTokens: 0, outputTokens: 0, elapsedMs: 0 },
      startedAt: Date.now(),
    };
    const controller = new AbortController();
    this.controllers.set(`${opts.packId}/${runId}`, controller);
    this.live.set(runId, rec);
    void this.drive(rec, controller).finally(() => {
      // feature 023: teardown resolves run-scoped pending script consent
      this.deps.scripts?.discardPending(runId);
      this.controllers.delete(`${opts.packId}/${runId}`);
      this.live.delete(runId);
    });
    return runId;
  }

  // feature 023: a runtime:"script" step — resolves the library entry,
  // runs the same consent flow as chat (pending → tool.update →
  // tool.respond, ns = runId), then folds captured stdout into step
  // outputs (JSON stdout → object; else {output}). pack-script.md.
  private async runScriptStep(
    runId: string,
    slug: string,
    args: Record<string, unknown>,
    path: string,
  ): Promise<Record<string, unknown>> {
    const svc = this.deps.scripts;
    if (!svc || !svc.scriptsActive()) {
      throw new FabricError("SCRIPT_NOT_FOUND", "scripts are disabled", path);
    }
    const entry = svc.get(slug);
    if (!entry || !entry.enabled) {
      throw new FabricError("SCRIPT_NOT_FOUND", `no enabled script "${slug}"`, path);
    }
    const call: ToolCallRecord = {
      id: crypto.randomUUID(),
      tool: "run_script",
      path: slug,
      script: entry.id,
      args,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    // feature 027 (R3): same consent semantics as the chat loop — changed
    // linked content re-prompts even under a session grant; missing source
    // fails the step with a distinct error
    const consent = svc.consentState(entry, runId);
    if (consent === "source-missing") {
      call.status = "refused";
      call.error = "script source missing";
      this.deps.onToolCall?.(runId, call);
      throw new FabricError(
        "SCRIPT_SOURCE_MISSING",
        `the file for script "${slug}" is missing or unreadable — relink it`,
        path,
      );
    }
    let decision: ScriptDecision = "approve";
    if (consent !== "auto") {
      if (consent === "ask-changed") call.contentChanged = true;
      const deferred = svc.awaitDecision(call.id, runId, entry.id);
      this.deps.onToolCall?.(runId, call);
      decision = await deferred;
      call.decidedAt = new Date().toISOString();
    }
    if (decision !== "approve" && decision !== "allowSession" && decision !== "approveChangedSession") {
      call.status = "denied";
      call.decidedAt ??= new Date().toISOString();
      this.deps.onToolCall?.(runId, call);
      throw new FabricError(
        "CAPABILITY_DENIED",
        decision === "discard" ? "run cancelled" : "the user denied this script call",
        path,
      );
    }
    call.status = "approved";
    this.deps.onToolCall?.(runId, call);
    let rec;
    try {
      rec = await svc.call({ entry, args, initiator: "pipeline", ns: runId, callId: call.id });
    } catch (e) {
      call.status = "error";
      call.error = (e as Error).message;
      this.deps.onToolCall?.(runId, call);
      throw e;
    }
    call.status = rec.verdict === "executed" ? "executed" : "error";
    call.exitStatus = rec.exitStatus;
    call.durationMs = rec.durationMs;
    call.files = rec.files;
    call.sessionRestarted = rec.sessionRestarted;
    this.deps.onToolCall?.(runId, call);
    if (rec.verdict !== "executed") {
      throw new FabricError("ENGINE_ERROR", `script "${slug}" failed`, path);
    }
    try {
      const parsed: unknown = JSON.parse(rec.stdout);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return { output: parsed };
    } catch {
      return { output: rec.stdout };
    }
  }

  private trace(rec: RunRecord, e: Omit<TraceEntry, "seq">): void {
    const entry: TraceEntry = { seq: this.seq++, ...e };
    rec.trace.push(entry);
    if (e.kind === "step") rec.usage.steps++;
    if (e.kind === "delegation") rec.usage.delegations++;
    this.deps.onTrace?.(rec.id, entry);
  }

  private async drive(rec: RunRecord, controller: AbortController): Promise<void> {
    const t0 = Date.now();
    const setStatus = (status: RunStatus, error?: RunRecord["error"]) => {
      rec.status = status;
      rec.error = error;
      rec.endedAt = Date.now();
      rec.usage.elapsedMs = rec.endedAt - t0;
      this.persist(rec);
      this.deps.onStatus?.(rec.id, status, error);
    };
    rec.status = "running";
    this.deps.onStatus?.(rec.id, "running");
    // abort → stop the in-flight model call too (T030: AbortSignal →
    // engine.stop()); boundary checks alone can't unblock generate()
    const engine = this.deps.engine();
    const onAbort = () => engine.stop?.();
    controller.signal.addEventListener("abort", onAbort);
    try {
      const ctx: RunCtx = {
        engine,
        signal: controller.signal,
        path: rec.target.id,
        resolveSkill: (ref) => this.deps.registry.lookupSkill(ref),
        runPipeline: async (pl, inputs, params, path) => {
          const out = await executePipeline(pl, inputs, params, rec.objective, { ...ctx, path }, { trace: (e) => this.trace(rec, e) });
          return out;
        },
        runScript: this.deps.scripts
          ? async (slug, args, path) => this.runScriptStep(rec.id, slug, args, path)
          : undefined,
        onModelCall: (u) => {
          rec.usage.modelCalls++;
          rec.usage.promptTokens += u.promptTokens ?? 0;
          rec.usage.outputTokens += u.outputTokens;
          if (rec.usage.modelCalls > (rec.budget.maxModelCalls ?? DEFAULT_BUDGET.maxModelCalls)) {
            throw new FabricError("ENGINE_ERROR", "maxModelCalls budget exceeded", rec.target.id);
          }
        },
      };
      let out: Record<string, unknown>;
      if (rec.target.kind === "pipeline") {
        const ref = rec.target.id.includes(":") ? rec.target.id : `${rec.packId}:${rec.target.id}`;
        const pl = this.deps.registry.lookupSkill(ref);
        if (!pl?.steps) {
          throw new FabricError("CONTRIBUTION_NOT_FOUND", `pipeline "${rec.target.id}" not found`, rec.target.id);
        }
        out = await executePipeline(pl, { ...rec.params }, rec.params, rec.objective, ctx, { trace: (e) => this.trace(rec, e) });
      } else {
        const ref = rec.target.id.includes(":") ? rec.target.id : `${rec.packId}:${rec.target.id}`;
        const agent = this.deps.registry.lookupAgentContrib(ref);
        if (!agent) {
          throw new FabricError("CONTRIBUTION_NOT_FOUND", `agent "${rec.target.id}" not found`, rec.target.id);
        }
        out = await runAgent(
          agent,
          { objective: rec.objective, params: rec.params, budget: { ...DEFAULT_BUDGET, ...rec.budget, ...agent.fm.budget } },
          ctx,
          this.deps.registry,
          { trace: (e) => this.trace(rec, e) },
        );
      }
      if (rec.usage.steps > (rec.budget.maxSteps ?? DEFAULT_BUDGET.maxSteps)) {
        throw new FabricError("ENGINE_ERROR", "maxSteps budget exceeded", rec.target.id);
      }
      for (const [name, value] of Object.entries(out)) {
        rec.artifacts.push({ name, type: typeof value === "string" ? "text" : typeof value === "number" ? "number" : "json", value, stepId: rec.target.id });
        this.trace(rec, { stepId: rec.target.id, kind: "artifact", path: rec.target.id, status: "produced", output: { name } });
      }
      setStatus(controller.signal.aborted ? "cancelled" : "completed");
    } catch (e) {
      const aborted = controller.signal.aborted || (e instanceof FabricError && e.code === "NOT_GENERATING");
      setStatus(aborted ? "cancelled" : "failed", aborted
        ? { code: "CANCELLED", message: "run cancelled" }
        : { code: e instanceof FabricError ? e.code : "ENGINE_ERROR", message: e instanceof Error ? e.message : String(e), path: e instanceof FabricError ? e.path : undefined });
    } finally {
      controller.signal.removeEventListener("abort", onAbort);
      this.prune(rec.packId);
    }
  }
}

export type { ComponentEngine };
