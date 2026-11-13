// feature 026 (FR-013): the persona rules the server enforces
// (src/bun/personas/service.ts), mirrored so the form can say what is wrong
// before saving. Pure, so it is tested.
import { specFor, validateParamInput } from "../settings/param-spec";

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_NAME_LENGTH = 32;
export const MAX_PROMPT_BYTES = 8 * 1024;
export const MAX_SNIPPET_BYTES = 4 * 1024;

const bytes = (s: string) => new TextEncoder().encode(s).length;

export interface PersonaDraftLike {
  name: string;
  systemPrompt: string;
  temperature: string;
  topP: string;
  maxTokens: string;
}

export type PersonaErrors = Partial<Record<keyof PersonaDraftLike, string>>;

export function validateName(name: string, label = "Name"): string | null {
  const n = name.trim();
  if (n === "") return `${label} is required`;
  if (n.length > MAX_NAME_LENGTH) return `${label} must be at most ${MAX_NAME_LENGTH} characters`;
  if (!SLUG_RE.test(n)) return `${label} may use lowercase letters, numbers and single dashes (for example "code-review")`;
  return null;
}

export function validatePersonaDraft(d: PersonaDraftLike): PersonaErrors {
  const out: PersonaErrors = {};
  const nameErr = validateName(d.name);
  if (nameErr) out.name = nameErr;
  if (d.systemPrompt.trim() === "") out.systemPrompt = "The system prompt is required";
  else if (bytes(d.systemPrompt) > MAX_PROMPT_BYTES) {
    out.systemPrompt = `The system prompt is ${bytes(d.systemPrompt)} bytes; the limit is ${MAX_PROMPT_BYTES}`;
  }
  for (const key of ["temperature", "topP", "maxTokens"] as const) {
    const e = validateParamInput(specFor(key), d[key], true);
    if (e) out[key] = e;
  }
  return out;
}

export function validateSnippet(name: string, text: string): { name?: string; text?: string } {
  const out: { name?: string; text?: string } = {};
  const n = validateName(name, "Name");
  if (n) out.name = n;
  if (text.trim() === "") out.text = "The text is required";
  else if (bytes(text) > MAX_SNIPPET_BYTES) {
    out.text = `The text is ${bytes(text)} bytes; the limit is ${MAX_SNIPPET_BYTES}`;
  }
  return out;
}
