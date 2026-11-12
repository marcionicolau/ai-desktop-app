// feature 018: startup model-selection prompt trigger (FR-001/003/004/006/007).
// Pure decision fn so the headless tests can drive every branch; the
// ChatPage effect latches `evaluated` so it fires once per session.
import type { ModelStatus } from "@shared/types";

export type StartupPromptDecision = "wait" | "open" | "settle";

export function decideStartupPrompt(args: {
  hydrated: boolean; // model.status reconciliation completed at least once
  evaluated: boolean; // latch — already decided this session
  status: ModelStatus;
}): StartupPromptDecision {
  if (args.evaluated || !args.hydrated) return "wait";
  if (args.status === "loading") return "wait"; // configured model in flight (FR-006)
  if (args.status === "unloaded" || args.status === "error") return "open";
  return "settle"; // ready — no usable-model prompt needed (FR-003)
}
