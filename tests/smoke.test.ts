import { describe, expect, test } from "bun:test";

describe("test harness", () => {
  test("bun test discovers and runs project tests", () => {
    expect(true).toBe(true);
  });
});
