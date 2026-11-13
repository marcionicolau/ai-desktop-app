// feature 023: interpreter resolution (FR-002/FR-003). User-configured
// paths take precedence over auto-detection; missing interpreters
// report status "missing" — never throw.
import { existsSync } from "node:fs";
import type {
  RuntimeStatus,
  ScriptPolicy,
  ScriptRuntimeKind,
} from "../../shared/types";

const CANDIDATES: Record<ScriptRuntimeKind, readonly string[]> = {
  python: ["python3", "python"],
  r: ["Rscript"],
};

const FALLBACK_PATHS: Record<ScriptRuntimeKind, readonly string[]> = {
  python: [
    "/usr/bin/python3",
    "/usr/local/bin/python3",
    "/opt/homebrew/bin/python3",
    "/opt/homebrew/bin/python",
  ],
  r: ["/usr/bin/Rscript", "/usr/local/bin/Rscript"],
};

// first resolvable interpreter on PATH-ish locations; null when absent
export function detectInterpreter(kind: ScriptRuntimeKind): string | null {
  for (const c of CANDIDATES[kind]) {
    const p = Bun.which(c);
    if (p) return p;
  }
  for (const f of FALLBACK_PATHS[kind]) {
    if (existsSync(f)) return f;
  }
  return null;
}

// configured path wins when set and present; else detection
export function resolveInterpreter(
  kind: ScriptRuntimeKind,
  policy?: ScriptPolicy,
): { path: string | null; configured: string | null; detected: string | null } {
  const configured = policy?.runtimes?.[kind]?.path ?? null;
  const detected = detectInterpreter(kind);
  const path =
    configured && existsSync(configured) ? configured : detected;
  return { path, configured, detected };
}

export function runtimeStatus(
  kind: ScriptRuntimeKind,
  policy?: ScriptPolicy,
  session?: RuntimeStatus["session"],
): RuntimeStatus {
  const r = resolveInterpreter(kind, policy);
  return {
    kind,
    configuredPath: r.configured,
    detectedPath: r.detected,
    status: r.path ? "ready" : "missing",
    session: session ?? null,
  };
}
