// feature 023 T014: ScriptStore — slug uniqueness, stored/external
// sources, delete cascade, persistence round-trip.
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScriptEntry } from "../../src/shared/types";

const dir = mkdtempSync(join(tmpdir(), "cz-scripts-store-"));
process.env.APP_DATA_DIR = dir;

const { ScriptStore, slugify, isValidSlug } = await import(
  "../../src/bun/scripts/store"
);
const { scriptsDir } = await import("../../src/bun/store/paths");

const entry = (id: string, over: Partial<ScriptEntry> = {}): ScriptEntry => ({
  id,
  runtime: "python",
  source: { kind: "stored" },
  description: "",
  params: [],
  enabled: true,
  ...over,
});

describe("slugify", () => {
  test("kebab-cases display names", () => {
    expect(slugify("My Fancy Script!!")).toBe("my-fancy-script");
    expect(slugify("add one")).toBe("add-one");
  });
  test("isValidSlug rejects unsafe ids", () => {
    expect(isValidSlug("add-one")).toBe(true);
    expect(isValidSlug("../etc")).toBe(false);
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("UPPER")).toBe(false);
  });
});

describe("ScriptStore", () => {
  let store: InstanceType<typeof ScriptStore>;
  beforeAll(() => {
    store = new ScriptStore();
  });

  test("upsert + list + persisted round-trip", () => {
    store.upsert(entry("alpha"));
    store.upsert(entry("beta", { runtime: "r" }));
    expect(store.list().map((e) => e.id)).toEqual(["alpha", "beta"]);
    const fresh = new ScriptStore();
    expect(fresh.get("alpha")?.runtime).toBe("python");
    expect(fresh.get("beta")?.runtime).toBe("r");
  });

  test("stored source written under scriptsDir with runtime ext", () => {
    store.writeSource("alpha", "python", "print('hi')");
    const p = join(scriptsDir(), "alpha.py");
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, "utf8")).toBe("print('hi')");
    store.writeSource("beta", "r", "cat('hi')");
    expect(existsSync(join(scriptsDir(), "beta.R"))).toBe(true);
  });

  test("readSource prefers external path, degrades when absent", () => {
    const ext = join(dir, "external.py");
    rmSync(ext, { force: true });
    const e = entry("ext-s", { source: { kind: "external", path: ext } });
    expect(store.readSource(e)).toBeNull();
    store.writeSource("alpha", "python", "print(1)");
    expect(store.readSource(store.get("alpha")!)).toBe("print(1)");
  });

  test("delete removes entry and source file", () => {
    store.writeSource("alpha", "python", "x=1");
    expect(store.delete("alpha")).toBe(true);
    expect(store.get("alpha")).toBeNull();
    expect(existsSync(join(scriptsDir(), "alpha.py"))).toBe(false);
    expect(store.delete("nope")).toBe(false);
  });
});
