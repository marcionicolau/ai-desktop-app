import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Sandbox } from "../../src/bun/tools/sandbox";

const base = join(
  tmpdir(),
  `sandbox-test-${process.pid}-${Date.now().toString(36)}`,
);
const root = join(base, "root");
const outside = join(base, "outside");

beforeAll(() => {
  mkdirSync(join(root, "sub"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(root, "a.txt"), "inside");
  writeFileSync(join(outside, "secret.txt"), "outside");
  symlinkSync(outside, join(root, "escape"));
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("Sandbox.resolve", () => {
  const sb = () => new Sandbox(root);

  test("in-root relative file resolves", () => {
    const r = sb().resolve("a.txt");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.resolved).toBe(join(root, "a.txt"));
  });

  test("in-root nested path resolves", () => {
    expect(sb().resolve("sub").ok).toBe(true);
  });

  test(".. traversal is refused", () => {
    const r = sb().resolve("../outside/secret.txt");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("out-of-sandbox");
  });

  test("absolute out-of-root path is refused", () => {
    const r = sb().resolve(join(outside, "secret.txt"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("out-of-sandbox");
  });

  test("absolute in-root path resolves", () => {
    expect(sb().resolve(join(root, "a.txt")).ok).toBe(true);
  });

  test("symlink escape is refused", () => {
    const r = sb().resolve("escape/secret.txt");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("out-of-sandbox");
  });

  test("nonexistent in-root target is 'missing', not a refusal", () => {
    const r = sb().resolve("nope.txt");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing");
  });
});
