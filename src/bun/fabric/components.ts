// feature 017: component execution — host built-in deterministic
// components (research D6) + runtime:prompt skills over EngineLike.
// Declarative packs never ship code; compute lives here.
import { FabricError } from "./errors";
import type { SkillContrib } from "./registry";
import type { GenerationParams } from "../../shared/types";

export interface ComponentEngine {
  generate(
    prompt: string,
    onToken: (delta: string) => void,
    params?: GenerationParams | null,
    opts?: { roleKey?: string },
  ): Promise<{ status: "complete" | "partial"; tokens: number; promptTokens?: number }>;
  tokenCount(text: string): number;
  // run abort → stop any in-flight generation (EngineLike satisfies this)
  stop?(): void;
}

export interface RunCtx {
  engine: ComponentEngine;
  resolveSkill: (ref: string) => SkillContrib | null;
  runPipeline: (contrib: SkillContrib, inputs: Record<string, unknown>, params: Record<string, unknown>, path: string) => Promise<Record<string, unknown>>;
  onModelCall?: (usage: { promptTokens?: number; outputTokens: number }) => void;
  // feature 023: runtime:"script" steps — absent → SCRIPT_NOT_FOUND
  runScript?: (slug: string, args: Record<string, unknown>, path: string) => Promise<Record<string, unknown>>;
  signal?: AbortSignal;
  path: string; // trace path prefix
}

const abort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new FabricError("NOT_GENERATING", "run cancelled");
};

// --- template rendering for runtime:prompt ---

export function renderTemplate(
  tpl: string,
  scope: { params: Record<string, unknown>; inputs: Record<string, unknown>; objective: string },
): string {
  return tpl.replace(/\{\{|\}\}|\{(params|inputs|objective)(?:\.([^}]+))?\}/g, (m, ns: string, key?: string) => {
    if (m === "{{") return "{";
    if (m === "}}") return "}";
    if (ns === "objective") return scope.objective;
    const bag = ns === "params" ? scope.params : scope.inputs;
    const v = bag[key ?? ""];
    return v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  });
}

// --- output validation against declared ports ---

function portOk(type: string, v: unknown): boolean {
  switch (type) {
    case "text": return typeof v === "string";
    case "number": return typeof v === "number";
    case "list": return Array.isArray(v);
    case "json":
    case "any": return v !== undefined;
    default: return false;
  }
}

export function validateOutputs(
  outputs: Record<string, { type: string }>,
  produced: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  for (const [name, decl] of Object.entries(outputs)) {
    if (!portOk(decl.type, produced[name])) {
      throw new FabricError(
        "ENGINE_ERROR",
        `output "${name}" expected ${decl.type}, got ${JSON.stringify(produced[name])?.slice(0, 80)}`,
        path,
      );
    }
  }
  return produced;
}

// --- deterministic builtins (BUILTIN_COMPONENTS) ---

const str = (v: unknown) => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v));

export function runBuiltin(
  id: string,
  inputs: Record<string, unknown>,
  params: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  switch (id) {
    case "const":
      return { value: params.value ?? null };
    case "text.concat": {
      const parts = inputs.parts;
      const list = Array.isArray(parts) ? parts : [parts];
      const sep = str(params.separator ?? "");
      return { text: list.map(str).join(sep) };
    }
    case "text.template": {
      const tpl = str(params.template ?? "");
      const text = tpl.replace(/\{([^}]+)\}/g, (m, key: string) => str(inputs[key] ?? params[key] ?? m));
      return { text };
    }
    case "json.extract": {
      let cur: unknown = inputs.doc ?? inputs.json ?? inputs.value;
      const p = str(params.path ?? "");
      for (const seg of p.split(".").filter(Boolean)) {
        if (cur == null) break;
        cur = Array.isArray(cur) ? cur[Number(seg)] : (cur as Record<string, unknown>)[seg];
      }
      return { value: cur ?? null };
    }
    case "list.map": {
      const items = Array.isArray(inputs.items) ? inputs.items : [];
      const pick = str(params.pick ?? "");
      if (!pick) return { items };
      const items2 = items.map((it) => {
        let cur: unknown = it;
        for (const seg of pick.split(".").filter(Boolean)) {
          if (cur == null) break;
          cur = Array.isArray(cur) ? cur[Number(seg)] : (cur as Record<string, unknown>)[seg];
        }
        return cur ?? null;
      });
      return { items: items2 };
    }
    case "list.filter": {
      const items = Array.isArray(inputs.items) ? inputs.items : [];
      const pick = str(params.pick ?? "");
      const eq = params.equals;
      const keep = items.filter((it) => {
        let cur: unknown = it;
        for (const seg of pick.split(".").filter(Boolean)) {
          if (cur == null) break;
          cur = Array.isArray(cur) ? cur[Number(seg)] : (cur as Record<string, unknown>)[seg];
        }
        return eq === undefined ? Boolean(cur) : cur === eq;
      });
      return { items: keep };
    }
    default:
      throw new FabricError("CONTRACT_VIOLATION", `unknown builtin component "${id}"`, path);
  }
}

// --- runtime: prompt component ---

async function runPromptComponent(
  skill: SkillContrib,
  inputs: Record<string, unknown>,
  params: Record<string, unknown>,
  objective: string,
  ctx: RunCtx,
): Promise<Record<string, unknown>> {
  const fm = skill.view;
  const declared = Object.keys(fm.outputs).length > 0;
  const tpl = skill.instructions ?? "";
  const prompt = renderTemplate(tpl, { params, inputs, objective });
  const genParams: GenerationParams | null = skill.promptCfg?.temperature != null
    ? ({ temperature: skill.promptCfg.temperature } as GenerationParams)
    : null;
  let text = "";
  const res = await ctx.engine.generate(
    prompt,
    (d) => {
      text += d;
    },
    genParams,
    { roleKey: "fabric" },
  );
  ctx.onModelCall?.({ promptTokens: res.promptTokens, outputTokens: res.tokens });
  if (!declared) return { text };
  // declared outputs: model answers a JSON object of port values; one
  // tolerant retry-free parse (v1) — contract violation is a FabricError
  let parsed: unknown;
  try {
    const m = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
    parsed = JSON.parse(m ? (m[1] as string) : text);
  } catch {
    throw new FabricError("ENGINE_ERROR", "prompt component returned non-JSON output for declared ports", ctx.path);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new FabricError("ENGINE_ERROR", "prompt component output must be a JSON object", ctx.path);
  }
  return validateOutputs(fm.outputs, parsed as Record<string, unknown>, ctx.path);
}

// --- dispatch ---

export async function runSkill(
  skill: SkillContrib,
  inputs: Record<string, unknown>,
  params: Record<string, unknown>,
  objective: string,
  ctx: RunCtx,
): Promise<Record<string, unknown>> {
  abort(ctx.signal);
  const fm = skill.view;
  // input port validation
  for (const [name, decl] of Object.entries(fm.inputs)) {
    if (!portOk(decl.type, inputs[name])) {
      throw new FabricError("ENGINE_ERROR", `input "${name}" expected ${decl.type}`, ctx.path);
    }
  }
  const merged = { ...Object.fromEntries(
    Object.entries(fm.params).filter(([, d]) => d.default !== undefined).map(([k, d]) => [k, d.default]),
  ), ...params };
  let out: Record<string, unknown>;
  if (fm.runtime === "prompt") {
    out = await runPromptComponent(skill, inputs, merged, objective, ctx);
  } else if (fm.runtime === "script") {
    // feature 023: bound inputs + params become the script call's args
    if (!ctx.runScript) {
      throw new FabricError("SCRIPT_NOT_FOUND", "script execution unavailable", ctx.path);
    }
    out = await ctx.runScript(fm.script ?? "", { ...merged, ...inputs }, ctx.path);
  } else if (fm.runtime.startsWith("component:")) {
    out = runBuiltin(fm.runtime.slice("component:".length), inputs, merged, ctx.path);
  } else {
    throw new FabricError("CONTRACT_VIOLATION", `bad runtime "${fm.runtime}"`, ctx.path);
  }
  return validateOutputs(fm.outputs, out, ctx.path);
}
