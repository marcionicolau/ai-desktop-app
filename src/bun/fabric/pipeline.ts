// feature 017: pipeline DAG executor. Steps were already validated as
// topologically ordered at registration; this walks them in declared
// order, binds inputs ($objective / $params.* / <stepId>.<port>), runs
// each step (skill or nested pipeline), and collects the pipeline's
// declared output ports from the last producing step.
import { FabricError } from "./errors";
import { runSkill, type RunCtx } from "./components";
import type { SkillContrib } from "./registry";
import type { TraceEntry } from "../../shared/types";

export interface ExecHooks {
  trace?: (e: Omit<TraceEntry, "seq">) => void;
}

const refValue = (
  ref: string,
  stepOuts: Map<string, Record<string, unknown>>,
  params: Record<string, unknown>,
  objective: string,
  path: string,
): unknown => {
  if (ref === "$objective") return objective;
  if (ref.startsWith("$params.")) return params[ref.slice("$params.".length)];
  const [stepId, port] = ref.split(".");
  const outs = stepOuts.get(stepId as string);
  if (!outs) {
    throw new FabricError("CONTRACT_VIOLATION", `input ref "${ref}" has no producing step`, path);
  }
  return outs[port as string];
};

export async function executePipeline(
  pipeline: SkillContrib,
  inputs: Record<string, unknown>,
  params: Record<string, unknown>,
  objective: string,
  ctx: RunCtx,
  hooks?: ExecHooks,
): Promise<Record<string, unknown>> {
  const stepOuts = new Map<string, Record<string, unknown>>();
  const baseParams = { ...inputs, ...params };
  for (const step of pipeline.steps ?? []) {
    if (ctx.signal?.aborted) throw new FabricError("NOT_GENERATING", "run cancelled", ctx.path);
    const path = `${ctx.path}/${step.id}`;
    hooks?.trace?.({ stepId: step.id, kind: "step", path, status: "running", startedAt: Date.now() });
    const ref = step.uses.includes(":") ? step.uses : `${pipeline.view.packId}:${step.uses}`;
    const skill = ctx.resolveSkill(ref);
    if (!skill) {
      throw new FabricError("CONTRIBUTION_NOT_FOUND", `step "${step.id}" uses unknown skill "${step.uses}"`, path);
    }
    const bound: Record<string, unknown> = {};
    for (const [port, r] of Object.entries(step.inputs ?? {})) {
      bound[port] = refValue(r, stepOuts, baseParams, objective, path);
    }
    const stepParams = { ...baseParams, ...step.params };
    let out: Record<string, unknown>;
    if (skill.steps) {
      out = await ctx.runPipeline(skill, bound, stepParams, path);
    } else {
      out = await runSkill(skill, bound, stepParams, objective, { ...ctx, path });
    }
    stepOuts.set(step.id, out);
    hooks?.trace?.({ stepId: step.id, kind: "step", path, status: "completed", output: out, endedAt: Date.now() });
  }
  // declared pipeline outputs resolve to the last step producing each name
  const result: Record<string, unknown> = {};
  for (const name of Object.keys(pipeline.view.outputs)) {
    let found = false;
    for (const step of (pipeline.steps ?? []).toReversed()) {
      const outs = stepOuts.get(step.id);
      if (outs && name in outs) {
        result[name] = outs[name];
        found = true;
        break;
      }
    }
    if (!found) {
      throw new FabricError("ENGINE_ERROR", `pipeline output "${name}" was never produced`, ctx.path);
    }
  }
  return result;
}
