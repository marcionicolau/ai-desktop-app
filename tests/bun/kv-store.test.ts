import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SnapshotStore, entryKey } from "../../src/bun/kv/store";
import { modelFingerprint } from "../../src/bun/models/library";

let dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "kv-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

// engine protocol: blob lands at blobPath(key) first, then save() records it
function snap(
  s: SnapshotStore,
  convId: string,
  roleKey: string,
  bytes: number,
  fp = "fp",
  ctxSize = 4096,
) {
  const key = entryKey(convId, roleKey);
  writeFileSync(s.blobPath(key), Buffer.alloc(bytes, 1));
  s.save({ key, convId, roleKey, modelPath: "/m.gguf", fingerprint: fp, ctxSize });
}

describe("SnapshotStore", () => {
  test("save → lookup round-trip; stats reflect sizes", () => {
    const s = new SnapshotStore(tmp(), { enabled: true, maxBytes: 1e9 });
    snap(s, "c1", "main", 100);
    expect(s.lookup("c1/main", "fp", 4096)).toBe(s.blobPath("c1/main"));
    expect(s.stats()).toEqual({ count: 1, usedBytes: 100, maxBytes: 1e9 });
  });

  test("fingerprint or ctxSize mismatch → null (FR-003)", () => {
    const s = new SnapshotStore(tmp(), { enabled: true, maxBytes: 1e9 });
    snap(s, "c1", "main", 100, "fpA");
    expect(s.lookup("c1/main", "fpB", 4096)).toBeNull();
    expect(s.lookup("c1/main", "fpA", 8192)).toBeNull();
    expect(s.lookup("c1/main", "fpA", 4096)).not.toBeNull();
  });

  test("LRU evicts oldest updatedAt beyond cap (FR-005)", () => {
    const s = new SnapshotStore(tmp(), { enabled: true, maxBytes: 250 });
    snap(s, "c1", "main", 100);
    snap(s, "c2", "main", 100);
    snap(s, "c3", "main", 100); // 300 > 250 → c1 evicted
    expect(s.lookup("c1/main", "fp", 4096)).toBeNull();
    expect(existsSync(s.blobPath("c1/main"))).toBe(false);
    expect(s.stats().count).toBe(2);
    expect(s.stats().usedBytes).toBe(200);
  });

  test("clear removes blobs, is idempotent", () => {
    const s = new SnapshotStore(tmp(), { enabled: true, maxBytes: 1e9 });
    snap(s, "c1", "main", 100);
    snap(s, "c2", "planner", 50);
    expect(s.clear()).toEqual({ removed: 2, freedBytes: 150 });
    expect(s.stats().usedBytes).toBe(0);
    expect(s.clear()).toEqual({ removed: 0, freedBytes: 0 });
  });

  test("ctor sweeps torn .tmp and orphan .kv; drops blob-less entries", () => {
    const d = tmp();
    const s1 = new SnapshotStore(d, { enabled: true, maxBytes: 1e9 });
    snap(s1, "c1", "main", 100);
    // torn write + orphan blob + entry whose file vanished
    writeFileSync(join(d, "torn.tmp"), "x");
    writeFileSync(join(d, "orphan.kv"), "x");
    const m = JSON.parse(readFileSync(join(d, "index.json"), "utf8"));
    m.entries.push({
      key: "ghost/main", convId: "ghost", roleKey: "main",
      modelPath: "/m", fingerprint: "f", ctxSize: 1,
      file: "ghost_main.kv", sizeBytes: 10, updatedAt: "x",
    });
    writeFileSync(join(d, "index.json"), JSON.stringify(m));
    const s2 = new SnapshotStore(d, { enabled: true, maxBytes: 1e9 });
    expect(s2.stats().count).toBe(1); // only c1
    expect(existsSync(join(d, "torn.tmp"))).toBe(false);
    expect(existsSync(join(d, "orphan.kv"))).toBe(false);
  });

  test("disabled policy: save/lookup no-op, stats.maxBytes 0", () => {
    const s = new SnapshotStore(tmp(), { enabled: false, maxBytes: 0 });
    const key = "c1/main";
    writeFileSync(s.blobPath(key), Buffer.alloc(10));
    s.save({ key, convId: "c1", roleKey: "main", modelPath: "/m", fingerprint: "f", ctxSize: 1 });
    expect(s.lookup(key, "f", 1)).toBeNull();
    expect(s.stats().maxBytes).toBe(0);
  });
});

describe("modelFingerprint", () => {
  test("same-name byte replacement and size change both alter fingerprint", () => {
    const d = tmp();
    const p = join(d, "m.gguf");
    writeFileSync(p, Buffer.alloc(200_000, 1));
    const f1 = modelFingerprint(p);
    writeFileSync(p, Buffer.alloc(200_000, 2)); // same size, new bytes
    // mtime may collide — force-differ via utimes-less trick: size key differs anyway below
    const f2 = modelFingerprint(p);
    writeFileSync(p, Buffer.alloc(300_000, 2)); // new size
    const f3 = modelFingerprint(p);
    expect(f2).not.toBe(f1);
    expect(f3).not.toBe(f2);
  });
});
