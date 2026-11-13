import { describe, expect, test } from "bun:test";
import { DEFAULT_SCRIPT_TIMEOUT as SERVER_DEFAULT, MAX_SCRIPT_TIMEOUT as SERVER_MAX } from "../../src/bun/scripts/service";
import {
  DEFAULT_SCRIPT_TIMEOUT,
  MAX_SCRIPT_TIMEOUT,
  validateExternalPath,
  validateParamRows,
  validateScriptName,
  validateTimeout,
} from "../../src/renderer/src/features/scripts/script-rules";

describe("script rules", () => {
  test("limits match the server's", () => {
    expect(MAX_SCRIPT_TIMEOUT).toBe(SERVER_MAX);
    expect(DEFAULT_SCRIPT_TIMEOUT).toBe(SERVER_DEFAULT);
  });

  test("names are kebab-case slugs", () => {
    expect(validateScriptName("")).toBe("Name is required");
    expect(validateScriptName("Add One")).toContain("lowercase");
    expect(validateScriptName("add_one")).toContain("lowercase");
    expect(validateScriptName("add-one")).toBeNull();
  });

  test("timeouts: empty uses the default; otherwise whole ms within the cap", () => {
    expect(validateTimeout("")).toBeNull();
    expect(validateTimeout("30000")).toBeNull();
    expect(validateTimeout("abc")).toBe("Enter a whole number of milliseconds");
    expect(validateTimeout("1.5")).toBe("Enter a whole number of milliseconds");
    expect(validateTimeout("0")).toContain("between 1 and 300000");
    expect(validateTimeout("300001")).toContain("between 1 and 300000");
  });

  test("external paths must be absolute", () => {
    expect(validateExternalPath("")).toBe("Enter the path of the script file");
    expect(validateExternalPath("scripts/a.py")).toContain("absolute");
    expect(validateExternalPath("/home/me/a.py")).toBeNull();
    expect(validateExternalPath("C:\\scripts\\a.R")).toBeNull();
  });

  test("parameter rows: identifiers, no duplicates", () => {
    const rows = validateParamRows([
      { name: "n", type: "number", required: true },
      { name: "", type: "text", required: false },
      { name: "2bad", type: "text", required: false },
      { name: "n", type: "text", required: false },
    ]);
    expect(rows[0]).toBeUndefined();
    expect(rows[1]).toBe("Name is required");
    expect(rows[2]).toContain("identifier");
    expect(rows[3]).toBe("Duplicate of parameter 1");
  });
});

import { validateRunArgs } from "../../src/renderer/src/features/scripts/script-rules";

describe("run arguments", () => {
  const params = [
    { name: "n", type: "number" as const, required: true },
    { name: "cfg", type: "json" as const, required: false },
    { name: "flag", type: "bool" as const, required: false },
    { name: "label", type: "text" as const, required: true },
  ];

  test("required values must be present; optional ones may be empty", () => {
    const e = validateRunArgs(params, { n: "", label: "" });
    expect(e.n).toBe("This value is required");
    expect(e.label).toBe("This value is required");
    expect(e.cfg).toBeUndefined();
    expect(e.flag).toBeUndefined();
  });

  test("numbers and JSON are checked before running", () => {
    const e = validateRunArgs(params, { n: "x", cfg: "{bad", label: "ok" });
    expect(e.n).toBe("Enter a number");
    expect(e.cfg).toContain("Not valid JSON");
    expect(validateRunArgs(params, { n: "3", cfg: '{"a":1}', label: "ok" })).toEqual({});
  });
});
