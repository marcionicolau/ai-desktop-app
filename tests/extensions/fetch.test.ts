// feature 017: pack acquisition — tar/gzip round-trip, traversal
// rejection, size cap, registry resolution, folder copy (T013)
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractTgz, fetchPack } from "../../src/bun/extensions/fetch";
import { PackError } from "../../src/bun/fabric/errors";

const FX = join(import.meta.dir, "fixtures");

// minimal tar writer for fixtures (ustar, regular files only)
function tar(entries: { name: string; data: Uint8Array | string }[]): Uint8Array {
  const chunks: number[] = [];
  const push = (b: number[]) => chunks.push(...b);
  const str = (s: string, len: number) => {
    const b = new TextEncoder().encode(s);
    return [...b, ...new Array(Math.max(0, len - b.length)).fill(0)];
  };
  const oct = (n: number, len: number) => str(n.toString(8).padStart(len - 1, "0") + "\0", len);
  for (const e of entries) {
    const data = typeof e.data === "string" ? new TextEncoder().encode(e.data) : e.data;
    const h = new Array(512).fill(0);
    const set = (off: number, b: number[]) => b.forEach((v, i) => (h[off + i] = v));
    set(0, str(e.name, 100));
    set(100, oct(0o644, 8));
    set(108, oct(0, 8));
    set(116, oct(0, 8));
    set(124, oct(data.length, 12));
    set(136, oct(0, 12));
    h[156] = "0".charCodeAt(0);
    set(257, str("ustar", 6));
    set(263, str("00", 2));
    // checksum: spaces then octal
    const sum = h.reduce((a, b, i) => a + (i >= 148 && i < 156 ? 32 : b), 0);
    set(148, str(sum.toString(8).padStart(6, "0") + "\0 ", 8));
    push(h);
    push([...data]);
    push(new Array((512 - (data.length % 512)) % 512).fill(0));
  }
  push(new Array(1024).fill(0));
  return new Uint8Array(chunks);
}

const packFiles = (name = "mini-pack") => [
  { name: `${name}/pack.yaml`, data: `name: ${name}\nversion: 1.0.0\napiLevel: 1\n` },
  { name: `${name}/skills/a/SKILL.md`, data: "---\nname: a\nversion: 1\ndescription: d\nruntime: prompt\n---\n# A\n" },
];

describe("tar reader", () => {
  test("extracts entries incl. wrapping dir", async () => {
    const dest = mkdtempSync(join(tmpdir(), "tgz-"));
    const n = extractTgz(tar(packFiles()), dest);
    expect(n).toBe(2);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(join(dest, "mini-pack/pack.yaml"), "utf8")).toContain("mini-pack");
  });

  test("rejects ../ traversal entries", () => {
    const dest = mkdtempSync(join(tmpdir(), "tgz-"));
    const raw = tar([{ name: "../evil.txt", data: "x" }]);
    expect(() => extractTgz(raw, dest)).toThrowError(/traversal|unsafe/);
  });
});

describe("fetchPack", () => {
  test("folder source stages + parses manifest", async () => {
    const s = await fetchPack({ kind: "folder", path: join(FX, "notes-pack") });
    expect(s.manifest.name).toBe("notes-pack");
    expect(s.manifest.capabilities).toContain("models.generate");
  });

  test("missing folder → SOURCE_UNREACHABLE", async () => {
    await expect(fetchPack({ kind: "folder", path: "/nope/nada" })).rejects.toThrowError(PackError);
  });

  test("archive .tar with wrapping dir resolves packRoot", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "tgz-"));
    const file = join(tmp, "mini.tar");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(file, tar(packFiles()));
    const s = await fetchPack({ kind: "archive", path: file });
    expect(s.manifest.name).toBe("mini-pack");
    expect(s.dir.endsWith("mini-pack")).toBe(true);
  });

  test("file:// URL tarball installs", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "tgz-"));
    const file = join(tmp, "mini.tgz");
    const { writeFileSync } = await import("node:fs");
    const raw = tar(packFiles("url-pack"));
    const gz = await new Response(
      new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer();
    writeFileSync(file, new Uint8Array(gz));
    const s = await fetchPack({ kind: "url", url: `file://${file}` });
    expect(s.manifest.name).toBe("url-pack");
  });

  test("registry index resolves entry url", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "tgz-"));
    const { writeFileSync } = await import("node:fs");
    const raw = tar(packFiles("reg-pack"));
    const gz = await new Response(
      new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer();
    const tgzPath = join(tmp, "reg.tgz");
    writeFileSync(tgzPath, new Uint8Array(gz));
    const idx = join(tmp, "index.json");
    writeFileSync(idx, JSON.stringify({ packs: [{ name: "reg-pack", url: `file://${tgzPath}` }] }));
    const s = await fetchPack({ kind: "registry", url: `file://${idx}`, entry: "reg-pack" });
    expect(s.manifest.name).toBe("reg-pack");
  });

  test("registry missing entry → PACK_NOT_FOUND", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "tgz-"));
    const idx = join(tmp, "index.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(idx, JSON.stringify({ packs: [] }));
    await expect(
      fetchPack({ kind: "registry", url: `file://${idx}`, entry: "nope" }),
    ).rejects.toThrowError(/no entry/);
  });
});
