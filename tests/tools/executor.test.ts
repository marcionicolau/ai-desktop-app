import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RESULT_CAP, runTool } from "../../src/bun/tools/executor";

const dir = join(
  tmpdir(),
  `executor-test-${process.pid}-${Date.now().toString(36)}`,
);

beforeAll(() => {
  mkdirSync(join(dir, "sub"), { recursive: true });
  writeFileSync(join(dir, "a.txt"), "hello world");
  writeFileSync(join(dir, "b.txt"), "x");
  writeFileSync(join(dir, "big.txt"), "y".repeat(RESULT_CAP + 4096));
  writeFileSync(join(dir, "bin.dat"), Buffer.from([0x89, 0x00, 0x50]));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("runTool", () => {
  test("read_file returns utf-8 content", () => {
    const r = runTool("read_file", join(dir, "a.txt"));
    expect(r.ok).toBe(true);
    expect(r.content).toBe("hello world");
    expect(r.truncated).toBe(false);
  });

  test("read_file caps at 8 KiB with marker", () => {
    const r = runTool("read_file", join(dir, "big.txt"));
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(true);
    expect(r.content).toEndWith("\n…[truncated]");
    expect(r.bytes).toBeLessThanOrEqual(RESULT_CAP + 20);
  });

  test("read_file rejects binary", () => {
    const r = runTool("read_file", join(dir, "bin.dat"));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("binary");
  });

  test("list_dir emits name/ for dirs, sorted", () => {
    const r = runTool("list_dir", dir);
    expect(r.ok).toBe(true);
    const lines = r.content.split("\n");
    expect(lines).toContain("a.txt");
    expect(lines).toContain("sub/");
    expect(lines).toEqual([...lines].sort());
  });

  test("missing path returns an error result", () => {
    const r = runTool("read_file", join(dir, "gone.txt"));
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});
