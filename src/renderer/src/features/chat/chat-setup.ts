// feature 026 (FR-023, FR-024): pure rules behind the chat header's setup
// cluster, kept free of React so they are unit-tested.
import type { FusionAdvise } from "@shared/types";

export type ChatMode = "single" | "fusion";

// which model controls a mode shows: one choice in single mode, the
// planner + executor pair in fusion mode — never both
export function modelControls(mode: ChatMode): ("model" | "planner" | "executor")[] {
  return mode === "fusion" ? ["planner", "executor"] : ["model"];
}

// roles the current fusion pair needs but that are not bound to a file
export function unboundRoles(
  mode: ChatMode,
  plannerTag: string,
  executorTag: string,
  boundNames: string[],
): string[] {
  if (mode !== "fusion") return [];
  return [plannerTag, executorTag].filter(
    (t, i, all) => all.indexOf(t) === i && !boundNames.includes(t),
  );
}

export interface FitStatus {
  label: string; // short, shown in the badge
  variant: "success" | "warning" | "destructive";
  detail: string; // shown on hover/focus
}

const gb = (n: number) => `${(n / 1e9).toFixed(1)} GB`;

export function fitStatus(
  f: Pick<FusionAdvise, "verdict" | "sequentialPeakBytes" | "combinedBytes">,
): FitStatus {
  const detail = `Sequential peak ${gb(f.sequentialPeakBytes)} · both resident ${gb(f.combinedBytes)}`;
  switch (f.verdict) {
    case "fits":
      return { label: "Pair fits", variant: "success", detail };
    case "tight":
      return { label: "Pair is tight", variant: "warning", detail };
    default:
      return { label: "Pair won't fit", variant: "destructive", detail };
  }
}

// persona selector ids: a sentinel stands for "no persona"
export const NO_PERSONA = "__none__";
export const personaToId = (name: string | null): string => name ?? NO_PERSONA;
export const idToPersona = (id: string): string | null => (id === NO_PERSONA ? null : id);
