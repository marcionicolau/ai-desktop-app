// feature 015: append-only audit (research D10, FR-011). One JSON line
// per executed-or-errored call in dataDir()/tool-audit.jsonl — survives
// conversation deletion and never writes secrets (paths only).
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AuditEntry } from "../../shared/types";
import { dataDir } from "../store/paths";

export function auditFile(): string {
  return join(dataDir(), "tool-audit.jsonl");
}

// best-effort — audit failure must not break the turn
export function recordAudit(entry: AuditEntry): void {
  try {
    const f = auditFile();
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, JSON.stringify(entry) + "\n");
  } catch {
    /* audit is observability, not control flow */
  }
}
