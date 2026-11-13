// feature 026 (FR-013): what a user needs to know about each generation
// parameter — label, unit, allowed range, help — and the validation that
// mirrors the server's (src/bun/llama/params.ts validateParams), so a bad
// value is caught inline before the round trip. Pure, so it is tested.
import type { GenerationParams } from "@shared/types";

export interface ParamSpec {
  key: keyof GenerationParams;
  label: string;
  help: string;
  min: number;
  max: number; // Infinity = no upper bound
  step: number;
  integer: boolean;
  unit?: string;
  // bounded 0–2 style parameters also get a slider
  slider?: { min: number; max: number };
}

export const PARAM_SPECS: ParamSpec[] = [
  { key: "temperature", label: "Temperature", help: "Higher is more varied; 0 always picks the most likely word.", min: 0, max: 2, step: 0.05, integer: false, slider: { min: 0, max: 2 } },
  { key: "topP", label: "Top-p", help: "Only consider the smallest set of words whose probabilities add up to this; 1 turns it off.", min: 0, max: 1, step: 0.05, integer: false, slider: { min: 0, max: 1 } },
  { key: "topK", label: "Top-k", help: "Only consider this many most likely words; 0 turns it off.", min: 0, max: Infinity, step: 1, integer: true },
  { key: "repeatPenalty", label: "Repeat penalty", help: "Above 1 discourages repeating itself — try 1.1 if a small model loops; 1 turns it off.", min: 0, max: Infinity, step: 0.05, integer: false, slider: { min: 0, max: 2 } },
  { key: "seed", label: "Seed", help: "Fixes the random choices so a reply can be reproduced; 0 is random.", min: 0, max: 0xffffffff, step: 1, integer: true },
  { key: "maxTokens", label: "Max tokens", help: "Longest reply allowed; 0 uses whatever fits in the context.", min: 0, max: Infinity, step: 1, integer: true, unit: "tokens" },
  { key: "nThreads", label: "Threads", help: "CPU threads used for generation; 0 chooses automatically.", min: 0, max: Infinity, step: 1, integer: true, unit: "threads" },
  { key: "nGpuLayers", label: "GPU layers", help: "How many layers run on the GPU; 0 keeps everything on the CPU.", min: 0, max: Infinity, step: 1, integer: true, unit: "layers" },
];

export const specFor = (key: keyof GenerationParams): ParamSpec =>
  PARAM_SPECS.find((s) => s.key === key)!;

export function describeRange(s: ParamSpec): string {
  const unit = s.unit ? ` ${s.unit}` : "";
  return Number.isFinite(s.max) ? `${s.min}–${s.max}${unit}` : `${s.min} or more${unit}`;
}

// null = valid. An empty string means "inherit" and is valid when allowed.
export function validateParamInput(
  s: ParamSpec,
  raw: string,
  allowEmpty: boolean,
): string | null {
  const text = raw.trim();
  if (text === "") return allowEmpty ? null : "Enter a value";
  const n = Number(text);
  if (!Number.isFinite(n)) return "Enter a number";
  if (s.integer && !Number.isInteger(n)) return "Must be a whole number";
  if (n < s.min || n > s.max) {
    return Number.isFinite(s.max)
      ? `Must be between ${s.min} and ${s.max}`
      : `Must be ${s.min} or more`;
  }
  return null;
}

// ---- editing drafts --------------------------------------------------------
// Forms edit text (so "0." or an empty box is representable); only valid,
// non-empty fields become parameters. An empty field means "inherit".

export type ParamKey = keyof GenerationParams;
export type ParamDraft = Partial<Record<ParamKey, string>>;
export type ParamErrors = Partial<Record<ParamKey, string>>;

export function paramsToDraft(p: Partial<GenerationParams> | null | undefined): ParamDraft {
  const out: ParamDraft = {};
  for (const s of PARAM_SPECS) {
    const v = p?.[s.key];
    if (typeof v === "number") out[s.key] = String(v);
  }
  return out;
}

export function draftErrors(d: ParamDraft): ParamErrors {
  const out: ParamErrors = {};
  for (const s of PARAM_SPECS) {
    const err = validateParamInput(s, d[s.key] ?? "", true);
    if (err) out[s.key] = err;
  }
  return out;
}

// valid, non-empty fields only
export function draftToParams(d: ParamDraft): Partial<GenerationParams> {
  const out: Partial<GenerationParams> = {};
  for (const s of PARAM_SPECS) {
    const text = (d[s.key] ?? "").trim();
    if (text !== "" && validateParamInput(s, text, true) === null) out[s.key] = Number(text);
  }
  return out;
}

// two drafts are the same when every field has the same numeric/empty value
export function sameDraft(a: ParamDraft, b: ParamDraft): boolean {
  return PARAM_SPECS.every((s) => {
    const x = (a[s.key] ?? "").trim();
    const y = (b[s.key] ?? "").trim();
    if (x === "" || y === "") return x === y;
    return Number(x) === Number(y);
  });
}

// the server reports "temperature out of range (0..2)": find the field it names
export function serverErrorKey(message: string): ParamKey | null {
  const hit = PARAM_SPECS.find((s) => new RegExp(`\\b${s.key}\\b`).test(message));
  return hit ? hit.key : null;
}
