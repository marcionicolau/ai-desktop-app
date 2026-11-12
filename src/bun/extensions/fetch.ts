// feature 017: pack acquisition — folder copy, .tgz archive extraction
// (hand-rolled tar reader over DecompressionStream, research D7), remote
// URL fetch, and registry-JSON resolution. Produces a staged directory +
// parsed manifest; the store moves it into extensionsDir.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, normalize } from "node:path";
import { PackError } from "../fabric/errors";
import { parseManifest } from "../fabric/frontmatter";
import type { PackManifest } from "../../shared/pack-schema";
import type { PackSource } from "../../shared/types";

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 2000;

export interface StagedPack {
  dir: string;
  manifest: PackManifest;
}

function stage(): string {
  return mkdtempSync(join(tmpdir(), "aipack-"));
}

function packRoot(dir: string): string {
  if (existsSync(join(dir, "pack.yaml"))) return dir;
  // tolerate a single wrapping directory (common in packed tarballs)
  const subs = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (subs.length === 1 && existsSync(join(dir, subs[0]!.name, "pack.yaml"))) {
    return join(dir, subs[0]!.name);
  }
  throw new PackError("PACK_INVALID", "pack.yaml not found", { file: dir });
}

function readManifestFrom(dir: string): PackManifest {
  const root = packRoot(dir);
  const file = join(root, "pack.yaml");
  return parseManifest(file, readFileSync(file, "utf8"));
}

// --- tar reader (ustar, regular files + dirs only) ---

function tarName(block: Uint8Array, off: number, prefix: Uint8Array): string {
  const nul = (b: Uint8Array) => {
    const i = b.indexOf(0);
    return new TextDecoder().decode(i < 0 ? b : b.subarray(0, i));
  };
  const name = nul(block.subarray(off, off + 100));
  const pre = nul(prefix);
  return pre ? `${pre}/${name}` : name;
}

export function* untar(buf: Uint8Array): Generator<{ name: string; type: string; data: Uint8Array }> {
  let off = 0;
  while (off + 512 <= buf.length) {
    const block = buf.subarray(off, off + 512);
    if (block.every((b) => b === 0)) return; // end-of-archive marker
    const sizeOct = new TextDecoder().decode(block.subarray(124, 136)).replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeOct || "0", 8);
    const type = String.fromCharCode(block[156] ?? 48);
    const prefix = block.subarray(345, 500);
    const name = tarName(block, 0, prefix);
    off += 512;
    if (Number.isNaN(size) || size < 0) {
      throw new PackError("ARCHIVE_INVALID", `bad tar size at "${name}"`);
    }
    yield { name, type, data: buf.subarray(off, off + size) };
    off += Math.ceil(size / 512) * 512;
  }
}

function safeJoin(root: string, rel: string): string {
  const p = normalize(join(root, rel));
  if (!p.startsWith(normalize(root) + "/")) {
    throw new PackError("ARCHIVE_INVALID", `path traversal in archive entry "${rel}"`);
  }
  return p;
}

export function extractTgz(tgz: Uint8Array, dest: string): number {
  if (tgz.length > MAX_ARCHIVE_BYTES) {
    throw new PackError("ARCHIVE_INVALID", `archive exceeds ${MAX_ARCHIVE_BYTES} bytes`);
  }
  let count = 0;
  mkdirSync(dest, { recursive: true });
  for (const e of untar(tgz)) {
    if (++count > MAX_FILES) {
      throw new PackError("ARCHIVE_INVALID", `archive exceeds ${MAX_FILES} files`);
    }
    if (!e.name || e.name === "./" || e.name === ".") continue;
    if (e.name.includes("..") || e.name.startsWith("/")) {
      throw new PackError("ARCHIVE_INVALID", `unsafe archive entry "${e.name}"`);
    }
    const target = safeJoin(dest, e.name);
    if (e.type === "5") {
      mkdirSync(target, { recursive: true });
    } else if (e.type === "0" || e.type === "\0") {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, e.data);
    }
    // other types (links, devices) are skipped — packs are static files only
  }
  return count;
}

async function gunzip(buf: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([buf as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url, { redirect: "follow" });
  } catch (e) {
    throw new PackError("SOURCE_UNREACHABLE", `cannot reach ${url}: ${e instanceof Error ? e.message : e}`);
  }
  if (!res.ok) {
    throw new PackError("SOURCE_UNREACHABLE", `${url} → HTTP ${res.status}`);
  }
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_ARCHIVE_BYTES) {
    throw new PackError("ARCHIVE_INVALID", `remote archive exceeds ${MAX_ARCHIVE_BYTES} bytes`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

// Fetches/copies the source into a fresh staging dir and returns it with
// the parsed manifest. Throws located PackError on any failure.
export async function fetchPack(source: PackSource): Promise<StagedPack> {
  const dir = stage();
  if (source.kind === "folder") {
    if (!existsSync(source.path)) {
      throw new PackError("SOURCE_UNREACHABLE", `folder not found: ${source.path}`);
    }
    cpSync(source.path, dir, { recursive: true });
    return { dir: packRoot(dir), manifest: readManifestFrom(dir) };
  }
  if (source.kind === "archive") {
    if (!existsSync(source.path)) {
      throw new PackError("SOURCE_UNREACHABLE", `archive not found: ${source.path}`);
    }
    const buf = new Uint8Array(readFileSync(source.path));
    if (source.path.endsWith(".tgz") || source.path.endsWith(".tar.gz")) {
      extractTgz(await gunzip(buf), dir);
    } else {
      extractTgz(buf, dir); // plain .tar
    }
    // tolerate a single wrapping directory (common in packed tarballs)
    return { dir: packRoot(dir), manifest: readManifestFrom(dir) };
  }
  if (source.kind === "url") {
    const buf = await fetchBytes(source.url);
    const isGzip = buf[0] === 0x1f && buf[1] === 0x8b;
    extractTgz(isGzip ? await gunzip(buf) : buf, dir);
    return { dir: packRoot(dir), manifest: readManifestFrom(dir) };
  }
  // registry: JSON index {packs: [{name, version, url, description?}]}
  const raw = await fetchBytes(source.url);
  let index: { packs?: { name?: string; url?: string }[] };
  try {
    index = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new PackError("PACK_INVALID", "registry index is not valid JSON", { file: source.url });
  }
  const entry = index.packs?.find((p) => p.name === source.entry);
  if (!entry?.url) {
    throw new PackError("PACK_NOT_FOUND", `registry has no entry "${source.entry}"`, { file: source.url });
  }
  const buf = await fetchBytes(entry.url);
  const isGzip = buf[0] === 0x1f && buf[1] === 0x8b;
  extractTgz(isGzip ? await gunzip(buf) : buf, dir);
  return { dir: packRoot(dir), manifest: readManifestFrom(dir) };
}

export function sourceRef(source: PackSource): string {
  if (source.kind === "registry") return `${source.url}#${source.entry}`;
  if (source.kind === "url") return source.url;
  return basename(source.path);
}
