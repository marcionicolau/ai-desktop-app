import { describe, expect, test } from "bun:test";
import { DENSITIES, isDensity, nextDensity } from "../../src/renderer/src/lib/density-core";

describe("density helpers", () => {
  test("only the two known densities are valid", () => {
    expect(DENSITIES).toEqual(["comfortable", "compact"]);
    expect(isDensity("compact")).toBe(true);
    expect(isDensity("comfortable")).toBe(true);
    expect(isDensity("tiny")).toBe(false);
    expect(isDensity(undefined)).toBe(false);
  });

  test("toggling alternates between the two", () => {
    expect(nextDensity("comfortable")).toBe("compact");
    expect(nextDensity("compact")).toBe("comfortable");
  });
});
