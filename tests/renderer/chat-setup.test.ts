import { describe, expect, test } from "bun:test";
import {
  fitStatus,
  idToPersona,
  modelControls,
  NO_PERSONA,
  personaToId,
  unboundRoles,
} from "../../src/renderer/src/features/chat/chat-setup";

describe("chat setup rules", () => {
  test("single mode has one model control; fusion has planner + executor, never all three", () => {
    expect(modelControls("single")).toEqual(["model"]);
    expect(modelControls("fusion")).toEqual(["planner", "executor"]);
  });

  test("unboundRoles lists only the missing roles of the fusion pair", () => {
    expect(unboundRoles("fusion", "planner", "executor", ["planner", "executor"])).toEqual([]);
    expect(unboundRoles("fusion", "planner", "executor", ["planner"])).toEqual(["executor"]);
    expect(unboundRoles("fusion", "planner", "executor", [])).toEqual(["planner", "executor"]);
    // same role for both → reported once
    expect(unboundRoles("fusion", "default", "default", [])).toEqual(["default"]);
    // single mode never needs the pair
    expect(unboundRoles("single", "planner", "executor", [])).toEqual([]);
  });

  test("fit status maps each verdict to a label, severity and a figures tooltip", () => {
    const base = { sequentialPeakBytes: 1.5e9, combinedBytes: 2.8e9 };
    expect(fitStatus({ verdict: "fits", ...base })).toEqual({
      label: "Pair fits",
      variant: "success",
      detail: "Sequential peak 1.5 GB · both resident 2.8 GB",
    });
    expect(fitStatus({ verdict: "tight", ...base }).variant).toBe("warning");
    const bad = fitStatus({ verdict: "wontfit", ...base });
    expect(bad.variant).toBe("destructive");
    expect(bad.label).toBe("Pair won't fit");
  });

  test("persona ids round-trip, with a sentinel for none", () => {
    expect(personaToId(null)).toBe(NO_PERSONA);
    expect(idToPersona(NO_PERSONA)).toBeNull();
    expect(idToPersona(personaToId("Coach"))).toBe("Coach");
  });
});
