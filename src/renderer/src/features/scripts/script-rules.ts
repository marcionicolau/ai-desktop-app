// feature 026 (FR-013): the script registry rules the server enforces
// (src/bun/scripts/service.ts), mirrored so the editor can explain a problem
// before saving. Pure, so a test pins the constants to the server's.
import type { ScriptParam } from "@shared/types";

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
export const MAX_SCRIPT_TIMEOUT = 300_000;
export const DEFAULT_SCRIPT_TIMEOUT = 30_000;

export function validateScriptName(name: string): string | null {
  const n = name.trim();
  if (n === "") return "Name is required";
  if (!SLUG_RE.test(n)) return 'Use lowercase letters, numbers and single dashes, for example "add-one"';
  return null;
}

// "" = use the default
export function validateTimeout(text: string): string | null {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isInteger(n)) return "Enter a whole number of milliseconds";
  if (n <= 0 || n > MAX_SCRIPT_TIMEOUT) return `Must be between 1 and ${MAX_SCRIPT_TIMEOUT} ms`;
  return null;
}

export function validateExternalPath(path: string): string | null {
  const p = path.trim();
  if (p === "") return "Enter the path of the script file";
  if (!(p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p))) return "Use an absolute path, starting with / (or a drive letter)";
  return null;
}

// one message per parameter row (index → message)
export function validateParamRows(params: ScriptParam[]): Record<number, string> {
  const out: Record<number, string> = {};
  const seen = new Map<string, number>();
  params.forEach((p, i) => {
    const n = p.name;
    if (n === "") out[i] = "Name is required";
    else if (!IDENT_RE.test(n)) out[i] = "Must be an identifier: letters, digits and _, not starting with a digit";
    else if (seen.has(n)) out[i] = `Duplicate of parameter ${seen.get(n)! + 1}`;
    else seen.set(n, i);
  });
  return out;
}

// ---- running a script with arguments ---------------------------------------

// one message per parameter name; empty optional values are fine
export function validateRunArgs(
  params: ScriptParam[],
  values: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of params) {
    const raw = (values[p.name] ?? "").trim();
    if (raw === "") {
      if (p.required) out[p.name] = "This value is required";
      continue;
    }
    if (p.type === "number" && !Number.isFinite(Number(raw))) out[p.name] = "Enter a number";
    else if (p.type === "json") {
      try {
        JSON.parse(raw);
      } catch (e) {
        out[p.name] = `Not valid JSON: ${(e as Error).message}`;
      }
    }
  }
  return out;
}
