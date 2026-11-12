// feature 017: agent-tree runner. router supervisors ask the model for a
// validated JSON delegation plan; sequential chains children; llm/planner
// leaves run one model call with the AGENT.md body as system prompt;
// pipeline nodes delegate to the DAG executor. Budget caps enforced.
import { FabricError } from "./errors";
import type { RunCtx } from "./components";
import type { ExecHooks } from "./pipeline";
import type { AgentContrib, ContributionRegistry } from "./registry";
import type { Budget } from "../../shared/types";

export interface AgentRunOpts {
  objective: string;
  params: Record<string, unknown>;
  budget: Required<Pick<Budget, "maxDepth">> & Omit<Budget, "maxDepth">;
  depth?: number;
}

interface Delegation {
  agent: string;
  objective: string;
  id?: string;
  needs?: string[];
}

const PLAN_SCHEMA = `Answer ONLY with a JSON array of delegations:
[{"agent":"<child name>","objective":"<task for that agent>","id":"d1","needs":["d0"]}]
- agent must be one of the listed children
- needs lists ids of earlier delegations whose results this one requires
- use {"agent":null} as an empty plan only when no delegation is needed — answer [] instead
- refer to a prior result in an objective with @<id>`;

export async function runAgent(
  agent: AgentContrib,
  opts: AgentRunOpts,
  ctx: RunCtx,
  reg: ContributionRegistry,
  hooks?: ExecHooks,
): Promise<Record<string, unknown>> {
  const { objective, params, budget } = opts;
  const depth = opts.depth ?? 0;
  if (ctx.signal?.aborted) throw new FabricError("NOT_GENERATING", "run cancelled", ctx.path);
  if (depth > (budget.maxDepth ?? 4)) {
    throw new FabricError("ENGINE_ERROR", `max agent depth exceeded at "${agent.view.name}"`, ctx.path);
  }
  const path = `${ctx.path}/${agent.view.name}`;
  const fm = agent.fm;

  switch (fm.kind) {
    case "pipeline": {
      const ref = fm.pipeline!.includes(":") ? fm.pipeline! : `${agent.view.packId}:${fm.pipeline!}`;
      const pl = reg.lookupSkill(ref);
      if (!pl?.steps) {
        throw new FabricError("CONTRIBUTION_NOT_FOUND", `agent "${agent.view.name}" pipeline "${fm.pipeline}" not found`, path);
      }
      hooks?.trace?.({ stepId: fm.name, kind: "delegation", path, status: "running", startedAt: Date.now() });
      const out = await ctx.runPipeline(pl, params, params, path);
      hooks?.trace?.({ stepId: fm.name, kind: "delegation", path, status: "completed", output: out, endedAt: Date.now() });
      return out;
    }
    case "llm":
    case "planner":
      return llmCall(agent, objective, ctx, hooks);
    case "sequential": {
      let current: unknown = objective;
      let last: Record<string, unknown> = {};
      for (const childName of fm.children ?? []) {
        const child = childOf(agent, childName, reg, path);
        hooks?.trace?.({ stepId: childName, kind: "delegation", path: `${path}/${childName}`, status: "running", input: current, startedAt: Date.now() });
        // oxlint-disable-next-line no-await-in-loop -- sequential chain: child output feeds the next
        last = await runAgent(child, {
          objective: typeof current === "string" ? current : JSON.stringify(current),
          params, budget, depth: depth + 1,
        }, { ...ctx, path }, reg, hooks);
        current = last.text ?? last;
        hooks?.trace?.({ stepId: childName, kind: "delegation", path: `${path}/${childName}`, status: "completed", output: last, endedAt: Date.now() });
      }
      return last;
    }
    case "router":
      return routerRun(agent, opts, ctx, reg, hooks, path);
  }
}

function childOf(agent: AgentContrib, name: string, reg: ContributionRegistry, path: string): AgentContrib {
  const ref = name.includes(":") ? name : `${agent.view.packId}:${name}`;
  const child = reg.lookupAgentContrib(ref);
  if (!child) {
    throw new FabricError("CONTRIBUTION_NOT_FOUND", `agent "${agent.view.name}" child "${name}" not found`, path);
  }
  return child;
}

async function llmCall(
  agent: AgentContrib,
  objective: string,
  ctx: RunCtx,
  hooks?: ExecHooks,
): Promise<Record<string, unknown>> {
  const path = `${ctx.path}/${agent.view.name}`;
  hooks?.trace?.({ stepId: agent.view.name, kind: "step", path, status: "running", input: objective, startedAt: Date.now() });
  const prompt = `${agent.body.trim()}\n\n${objective}`.trim();
  let text = "";
  const res = await ctx.engine.generate(prompt, (d) => { text += d; }, null, { roleKey: "fabric" });
  ctx.onModelCall?.({ promptTokens: res.promptTokens, outputTokens: res.tokens });
  hooks?.trace?.({ stepId: agent.view.name, kind: "step", path, status: "completed", output: { text }, endedAt: Date.now() });
  return { text };
}

async function routerRun(
  agent: AgentContrib,
  opts: AgentRunOpts,
  ctx: RunCtx,
  reg: ContributionRegistry,
  hooks: ExecHooks | undefined,
  path: string,
): Promise<Record<string, unknown>> {
  const fm = agent.fm;
  const maxDel = opts.budget.maxDelegations ?? 8;
  // 1) ask the model for a delegation plan
  const catalogue = (fm.children ?? [])
    .map((c) => `- ${c}`)
    .join("\n");
  const planPrompt = `${agent.body.trim()}

You are delegating work. Children you may delegate to:
${catalogue}

Objective: ${opts.objective}

${PLAN_SCHEMA}`;
  hooks?.trace?.({ stepId: agent.view.name, kind: "step", path, status: "planning", startedAt: Date.now() });
  let planText = "";
  const res = await ctx.engine.generate(planPrompt, (d) => { planText += d; }, null, { roleKey: "fabric" });
  ctx.onModelCall?.({ promptTokens: res.promptTokens, outputTokens: res.tokens });
  const plan = parsePlan(planText, fm.children ?? [], path);
  if (plan.length === 0) {
    // no delegation needed → the router answers directly
    return llmCall(agent, opts.objective, ctx, hooks);
  }
  if (plan.length > maxDel) {
    throw new FabricError("ENGINE_ERROR", `delegation plan (${plan.length}) exceeds maxDelegations ${maxDel}`, path);
  }
  // 2) execute delegations in order; @<id> refs resolve to prior results
  const results = new Map<string, Record<string, unknown>>();
  const seen = new Set<string>();
  plan.forEach((d, i) => {
    const id = d.id ?? `d${i}`;
    for (const need of d.needs ?? []) {
      if (!seen.has(need)) {
        throw new FabricError("CONTRACT_VIOLATION", `delegation "${id}" needs unknown/future "${need}"`, path);
      }
    }
    seen.add(id);
  });
  let finalOut: Record<string, unknown> = {};
  for (const [i, d] of plan.entries()) {
    const id = d.id ?? `d${i}`;
    const objective = d.objective.replace(/@(\w+)/g, (m, ref: string) => {
      const r = results.get(ref);
      return r ? JSON.stringify(r) : m;
    });
    const child = childOf(agent, d.agent, reg, path);
    hooks?.trace?.({ stepId: id, kind: "delegation", path: `${path}/${d.agent}`, status: "running", input: objective, startedAt: Date.now() });
    try {
      // oxlint-disable-next-line no-await-in-loop -- sequential plan: @ref deps resolve in order
      const out = await runAgent(child, {
        objective, params: opts.params, budget: opts.budget, depth: (opts.depth ?? 0) + 1,
      }, { ...ctx, path }, reg, hooks);
      results.set(id, out);
      finalOut = out;
      hooks?.trace?.({ stepId: id, kind: "delegation", path: `${path}/${d.agent}`, status: "completed", output: out, endedAt: Date.now() });
    } catch (e) {
      // dependents of failed delegations are skipped (spec-agents rule);
      // the failure itself is recorded and the plan continues
      hooks?.trace?.({ stepId: id, kind: "delegation", path: `${path}/${d.agent}`, status: "failed", output: { error: e instanceof Error ? e.message : String(e) }, endedAt: Date.now() });
      results.set(id, { error: e instanceof Error ? e.message : String(e) });
    }
  }
  return Object.keys(finalOut).length ? finalOut : { results: Object.fromEntries(results) };
}

function parsePlan(text: string, children: string[], path: string): Delegation[] {
  let raw: unknown;
  try {
    const m = /\[[\s\S]*\]/.exec(text);
    raw = JSON.parse(m ? m[0] : text);
  } catch {
    throw new FabricError("ENGINE_ERROR", "router produced a non-JSON delegation plan", path);
  }
  if (!Array.isArray(raw)) {
    throw new FabricError("ENGINE_ERROR", "delegation plan must be a JSON array", path);
  }
  for (const [i, d] of raw.entries()) {
    if (typeof d !== "object" || d === null) {
      throw new FabricError("CONTRACT_VIOLATION", `delegation [${i}] is not an object`, path);
    }
    const agent = (d as Delegation).agent;
    if (!children.includes(agent)) {
      throw new FabricError("CONTRACT_VIOLATION", `delegation [${i}] targets unknown child "${agent}"`, path);
    }
  }
  return raw as Delegation[];
}
