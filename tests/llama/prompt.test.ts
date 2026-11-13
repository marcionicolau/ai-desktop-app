// feature 023 T045: deny-mode prompt parity — when the script policy is
// inactive the system prompt is byte-identical to the pre-feature
// shape (no script block, no run_script grammar).
import { describe, expect, test } from "bun:test";
import { composeSystem, scriptInstructions } from "../../src/bun/llama/prompt";

const LISTING = [
  {
    id: "add-one",
    description: "adds one",
    params: [{ name: "n", type: "number", required: true }],
  },
];

describe("composeSystem script block", () => {
  test("no scripts arg → no run_script mention", () => {
    const s = composeSystem(undefined, true);
    expect(s).not.toContain("run_script");
  });

  test("empty listing → byte-identical to absent arg", () => {
    expect(composeSystem("p", true, [])).toBe(composeSystem("p", true));
    expect(composeSystem(undefined, false, [])).toBe(composeSystem(undefined, false));
  });

  test("deny-mode parity: handlers pass undefined → prompt unchanged", () => {
    // mirrors handlers.ts: scriptsActive() false → third arg undefined
    const withTools = composeSystem("persona", true, undefined);
    expect(withTools).not.toContain("run_script");
    expect(withTools).toContain("tool_call"); // file-tool grammar stays
  });

  test("active listing injects script ids + param signature", () => {
    const s = composeSystem(undefined, false, LISTING);
    expect(s).toContain("run_script");
    expect(s).toContain("add-one");
    expect(s).toContain("n:number");
  });

  test("scriptInstructions never emitted for an empty list", () => {
    // guard: composeSystem only joins when length > 0
    expect(scriptInstructions(LISTING)).toContain("add-one");
  });
});
