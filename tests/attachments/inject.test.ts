import { describe, expect, test } from "bun:test";
import {
  fitBudget,
  plannerSummary,
} from "../../src/bun/attachments/inject";
import type { StoredAttachment } from "../../src/bun/attachments/store";

const att = (id: string, fileName: string, content: string): StoredAttachment => ({
  id,
  path: `/x/${fileName}`,
  fileName,
  sizeBytes: content.length,
  content,
});

describe("fitBudget", () => {
  test("all files included when budget allows, in attach order", () => {
    const r = fitBudget(
      [att("1", "a.ts", "aaa"), att("2", "b.md", "bbb")],
      "question",
      10000,
    );
    expect(r.injectText).toContain('<file name="a.ts"');
    expect(r.injectText).toContain('<file name="b.md"');
    expect(r.injectText.indexOf("a.ts")).toBeLessThan(r.injectText.indexOf("b.md"));
    expect(r.records.map((x) => x.status)).toEqual(["full", "full"]);
    expect(r.warnings).toHaveLength(0);
  });

  test("oversized file truncates at a line boundary with marker", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
    const r = fitBudget([att("1", "big.txt", lines)], "q", 60);
    expect(r.records[0]!.status).toBe("truncated");
    expect(r.injectText).toContain("… [truncated]");
    expect(r.warnings[0]).toContain("big.txt");
    // cut happened at a line boundary, not mid-token
    const body = r.injectText.split("\n")[1]!;
    expect(body.startsWith("line ")).toBe(true);
  });

  test("files after a non-fitting one are excluded + warned", () => {
    const big = "x".repeat(2000);
    const r = fitBudget(
      [att("1", "big.txt", big), att("2", "small.txt", "s")],
      "q",
      200,
    );
    const statuses = r.records.map((x) => x.status);
    expect(statuses[1]).toBe("excluded");
    expect(r.injectText).not.toContain('<file name="small.txt"');
    expect(r.warnings).toHaveLength(2);
  });

  test("budget spent by user content excludes everything", () => {
    const r = fitBudget([att("1", "a.ts", "x")], "u".repeat(1000), 10);
    expect(r.records[0]!.status).toBe("excluded");
  });
});

describe("plannerSummary", () => {
  test("names + sizes only, no content", () => {
    const s = plannerSummary([
      att("1", "a.ts", "secret content"),
      att("2", "b.md", "x"),
    ]);
    expect(s).toContain("a.ts");
    expect(s).toContain("b.md");
    expect(s).toContain("KB");
    expect(s).not.toContain("secret content");
  });

  test("empty list -> empty string", () => {
    expect(plannerSummary([])).toBe("");
  });
});
