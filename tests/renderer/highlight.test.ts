import { describe, expect, test } from "bun:test";
import { splitHighlight } from "../../src/renderer/src/features/command/highlight";

describe("splitHighlight", () => {
  test("splits around the match and loses no text", () => {
    const r = splitHighlight("the quick brown fox", 4, 9);
    expect(r).toEqual({ before: "the ", match: "quick", after: " brown fox" });
    expect(r.before + r.match + r.after).toBe("the quick brown fox");
  });

  test("clamps out-of-range and inverted offsets", () => {
    expect(splitHighlight("abc", -5, 99)).toEqual({ before: "", match: "abc", after: "" });
    expect(splitHighlight("abc", 2, 1)).toEqual({ before: "ab", match: "", after: "c" });
    expect(splitHighlight("", 0, 3)).toEqual({ before: "", match: "", after: "" });
  });
});
