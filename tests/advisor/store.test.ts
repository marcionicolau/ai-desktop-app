// T005: fingerprint + benchmarks.json persistence (APP_DATA_DIR set before
// module import so dataDir() resolves into a per-file tmp dir)
import { test, expect, beforeAll } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir = "";
let store: typeof import("../../src/bun/advisor/store");

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "adv-store-"));
  process.env.APP_DATA_DIR = dir;
  store = await import("../../src/bun/advisor/store");
});

const REC = {
  fingerprint: "a.gguf:100",
  tokensPerSec: 12.5,
  peakBytes: 200,
  measuredAt: "2025-11-25T00:00:00.000Z",
};

test("fingerprint = fileName:sizeBytes", () => {
  expect(store.fingerprint("a.gguf", 100)).toBe("a.gguf:100");
});

test("missing file -> empty map", () => {
  expect(store.loadBenchmarks()).toEqual({});
});

test("save -> load round-trips; distinct size = distinct key", () => {
  store.saveRecord(REC);
  store.saveRecord({ ...REC, fingerprint: "a.gguf:200" });
  const all = store.loadBenchmarks();
  expect(all["a.gguf:100"].tokensPerSec).toBe(12.5);
  expect(all["a.gguf:200"]).toBeDefined();
});

test("corrupt JSON -> empty map (advisory data never fails)", () => {
  writeFileSync(join(dir, "benchmarks.json"), "{not json");
  expect(store.loadBenchmarks()).toEqual({});
});
