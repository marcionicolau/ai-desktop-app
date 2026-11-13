import { describe, expect, test } from "bun:test";
import { DEFAULT_GENERATION } from "../../src/shared/types";
import { validateParams } from "../../src/bun/llama/params";
import {
  describeRange,
  PARAM_SPECS,
  specFor,
  validateParamInput,
} from "../../src/renderer/src/features/settings/param-spec";

describe("param specs", () => {
  test("every generation parameter has a spec, with help text", () => {
    const keys = Object.keys(DEFAULT_GENERATION).sort();
    expect(PARAM_SPECS.map((s) => s.key).sort()).toEqual(keys);
    for (const s of PARAM_SPECS) expect(s.help.length).toBeGreaterThan(10);
  });

  test("ranges are described for display", () => {
    expect(describeRange(specFor("temperature"))).toBe("0–2");
    expect(describeRange(specFor("maxTokens"))).toBe("0 or more tokens");
  });

  test("empty input is valid only when inheriting is allowed", () => {
    expect(validateParamInput(specFor("topK"), "", true)).toBeNull();
    expect(validateParamInput(specFor("topK"), "  ", false)).toBe("Enter a value");
  });

  test("rejects non-numbers, fractions for whole-number params, and out-of-range values", () => {
    expect(validateParamInput(specFor("temperature"), "abc", true)).toBe("Enter a number");
    expect(validateParamInput(specFor("topK"), "2.5", true)).toBe("Must be a whole number");
    expect(validateParamInput(specFor("temperature"), "2.5", true)).toBe("Must be between 0 and 2");
    expect(validateParamInput(specFor("topP"), "-0.1", true)).toBe("Must be between 0 and 1");
    expect(validateParamInput(specFor("maxTokens"), "-1", true)).toBe("Must be 0 or more");
    expect(validateParamInput(specFor("seed"), "4294967296", true)).toBe("Must be between 0 and 4294967295");
  });

  test("accepts valid values", () => {
    expect(validateParamInput(specFor("temperature"), "0.7", true)).toBeNull();
    expect(validateParamInput(specFor("repeatPenalty"), "1.1", true)).toBeNull();
    expect(validateParamInput(specFor("seed"), "42", true)).toBeNull();
  });

  test("client validation agrees with the server's on the same values", () => {
    // whatever the client accepts the server must also accept
    const samples: [keyof typeof DEFAULT_GENERATION, number][] = [
      ["temperature", 0], ["temperature", 2], ["topP", 1], ["topK", 40], ["repeatPenalty", 1.1],
      ["seed", 4294967295], ["maxTokens", 0], ["nThreads", 8], ["nGpuLayers", 33],
    ];
    for (const [k, v] of samples) {
      expect(validateParamInput(specFor(k), String(v), false)).toBeNull();
      expect(validateParams({ [k]: v })).toBeNull();
    }
    // and what the client rejects the server rejects
    expect(validateParams({ temperature: 2.5 })).not.toBeNull();
    expect(validateParams({ topP: 1.5 })).not.toBeNull();
  });
});

import {
  draftErrors,
  draftToParams,
  paramsToDraft,
  sameDraft,
  serverErrorKey,
} from "../../src/renderer/src/features/settings/param-spec";

describe("param drafts", () => {
  test("params round-trip through a text draft, ignoring unset fields", () => {
    const d = paramsToDraft({ temperature: 0.7, topK: 40 });
    expect(d).toEqual({ temperature: "0.7", topK: "40" });
    expect(draftToParams(d)).toEqual({ temperature: 0.7, topK: 40 });
    expect(paramsToDraft(null)).toEqual({});
  });

  test("only valid non-empty fields become parameters; errors are per field", () => {
    const d = { temperature: "5", topK: "", repeatPenalty: "1.1", seed: "x" };
    expect(draftToParams(d)).toEqual({ repeatPenalty: 1.1 });
    const errs = draftErrors(d);
    expect(errs.temperature).toBe("Must be between 0 and 2");
    expect(errs.seed).toBe("Enter a number");
    expect(errs.topK).toBeUndefined();
    expect(errs.repeatPenalty).toBeUndefined();
  });

  test("dirty check compares values, not text", () => {
    expect(sameDraft({ temperature: "0.70" }, { temperature: "0.7" })).toBe(true);
    expect(sameDraft({ temperature: "0.7" }, {})).toBe(false);
    expect(sameDraft({ topK: " " }, {})).toBe(true);
  });

  test("a server range error is attributed to the field it names", () => {
    expect(serverErrorKey("temperature out of range (0..2)")).toBe("temperature");
    expect(serverErrorKey("maxTokens out of range (0..9007199254740991)")).toBe("maxTokens");
    expect(serverErrorKey("something else")).toBeNull();
  });
});
