// feature 027 (FR-002/003/006): pure grouping for the sidebar Scripts
// area — one collapsible group per language that has entries, alphabetical,
// with count + missing-runtime flag. Unit-tested in tests/renderer.
import type { ScriptListItem, ScriptRuntimeKind } from "@shared/types";

export interface ScriptGroup {
  runtime: ScriptRuntimeKind;
  label: string; // "Python" | "R"
  count: number;
  runtimeMissing: boolean; // interpreter unavailable for the whole language
  rows: ScriptListItem[]; // alphabetical by id
}

const LABEL: Record<ScriptRuntimeKind, string> = { python: "Python", r: "R" };

export function groupScripts(items: ScriptListItem[]): ScriptGroup[] {
  const byKind = new Map<ScriptRuntimeKind, ScriptListItem[]>();
  for (const s of items) {
    const list = byKind.get(s.runtime) ?? [];
    list.push(s);
    byKind.set(s.runtime, list);
  }
  const order: ScriptRuntimeKind[] = ["python", "r"];
  return order
    .filter((k) => (byKind.get(k) ?? []).length > 0)
    .map((k) => {
      const rows = byKind.get(k)!.toSorted((a, b) =>
        a.id.localeCompare(b.id, undefined, { sensitivity: "base" }),
      );
      return {
        runtime: k,
        label: LABEL[k],
        count: rows.length,
        runtimeMissing: rows.every((s) => s.runtimeStatus === "missing"),
        rows,
      };
    });
}
