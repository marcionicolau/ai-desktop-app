import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dataDir: string;
let store: typeof import("../../src/bun/attachments/store");

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "att-store-"));
  process.env.APP_DATA_DIR = dataDir;
  store = await import("../../src/bun/attachments/store");
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.APP_DATA_DIR;
});

const src = (name: string, content: string | Uint8Array) => {
  const p = join(dataDir, name);
  writeFileSync(p, content);
  return p;
};

describe("storeAttachment / pickAndStore", () => {
  test("valid text file is stored + resolvable", () => {
    const p = src("a.ts", "export const x = 1;\n");
    const r = store.pickAndStore([p]);
    expect(r.rejected).toHaveLength(0);
    expect(r.picked).toHaveLength(1);
    const meta = r.picked[0]!;
    expect(meta.fileName).toBe("a.ts");
    expect(meta.sizeBytes).toBeGreaterThan(0);
    const s = store.readAttachment(meta.id);
    expect(s.content).toContain("export const x = 1;");
  });

  test("binary file (NUL bytes) rejected with reason", () => {
    const p = src("bin.so", new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]));
    const r = store.pickAndStore([p]);
    expect(r.picked).toHaveLength(0);
    expect(r.rejected[0]!.reason).toContain("NUL");
  });

  test("invalid UTF-8 rejected", () => {
    const p = src("bad.txt", new Uint8Array([0xff, 0xfe, 0xfd, 0x80]));
    const r = store.pickAndStore([p]);
    expect(r.picked).toHaveLength(0);
    expect(r.rejected[0]!.reason).toBeTruthy();
  });

  test("same path re-picked dedups to the same id (FR-007)", () => {
    const p = src("dup.md", "hello");
    const a = store.pickAndStore([p]);
    const b = store.pickAndStore([p]);
    expect(b.picked[0]!.id).toBe(a.picked[0]!.id);
  });

  test("missing file rejected as unreadable", () => {
    const r = store.pickAndStore([join(dataDir, "nope.txt")]);
    expect(r.rejected[0]!.reason).toContain("unreadable");
  });

  test("unknown id -> INVALID_PARAMS", () => {
    try {
      store.readAttachment("does-not-exist");
      expect.unreachable();
    } catch (e) {
      expect((e as { code: string }).code).toBe("INVALID_PARAMS");
    }
  });
});

describe("gcFor", () => {
  test("removes files referenced by the deleted conversation", () => {
    const p = src("gone.ts", "x");
    const meta = store.pickAndStore([p]).picked[0]!;
    const f = join(dataDir, "attachments", `${meta.id}.json`);
    expect(existsSync(f)).toBe(true);
    store.gcFor({
      id: "c",
      title: "t",
      createdAt: "t",
      updatedAt: "t",
      mode: "single",
      plannerTag: "planner",
      executorTag: "executor",
      activeLeaf: null,
      messages: [
        {
          id: "m1",
          conversationId: "c",
          role: "user",
          content: "q",
          status: "complete",
          createdAt: "t",
          completedAt: "t",
          parentId: null,
          attachments: [
            { id: meta.id, fileName: "gone.ts", sizeBytes: 1, status: "full" },
          ],
        },
      ],
    });
    expect(existsSync(f)).toBe(false);
  });
});
