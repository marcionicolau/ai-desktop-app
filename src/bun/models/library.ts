// Model library: scan the models dir for .gguf files and read header
// metadata via lls_gguf_meta (no model load). Downloads also land here.
import { readdirSync, statSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { dataDir } from "../store/paths";
import { loadLlamaShim, newErrSlot, readErr } from "../llama/ffi";
import { CString, ptr, read } from "bun:ffi";
import type { ModelMeta } from "../../shared/types";

// dev layout puts models in <repo>/models; packaged runs use
// <userData>/models. MODELS_DIR env overrides both (tests).
export function modelsDir(): string {
  if (process.env.MODELS_DIR) return process.env.MODELS_DIR;
  const dev = join(process.cwd(), "models");
  try {
    if (statSync(dev).isDirectory()) return dev;
  } catch {
    // fall through to user-data dir
  }
  return join(dataDir(), "models");
}

export interface GgufMeta {
  name: string | null;
  architecture: string | null;
  paramCount: string | null;
  quantization: string | null;
  contextTrain: number | null;
}

// lls_gguf_meta returns a shim-owned JSON string; NULL + err on failure.
export function readGgufMeta(
  path: string,
  lib: ReturnType<typeof loadLlamaShim> = loadLlamaShim(),
): GgufMeta {
  const slot = newErrSlot();
  const addr = lib.symbols.lls_gguf_meta(path, ptr(slot));
  if (!addr) {
    const msg = readErr(lib, slot) ?? "gguf parse failed";
    throw new Error(msg);
  }
  const json = new CString(addr).toString();
  lib.symbols.lls_free_string(addr);
  return JSON.parse(json) as GgufMeta;
}

export function scanModels(): ModelMeta[] {
  const dir = modelsDir();
  mkdirSync(dir, { recursive: true });
  let lib: ReturnType<typeof loadLlamaShim> | null = null;
  try {
    lib = loadLlamaShim();
  } catch {
    // shim unavailable (e.g. test env without the built lib) — files
    // still list with null meta fields, same as unreadable GGUFs
  }
  const out: ModelMeta[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".gguf") || entry.endsWith(".part")) continue;
    const path = join(dir, entry);
    let size = 0;
    try {
      size = statSync(path).size;
    } catch {
      continue;
    }
    let meta: GgufMeta = {
      name: null,
      architecture: null,
      paramCount: null,
      quantization: null,
      contextTrain: null,
    };
    try {
      if (lib) meta = readGgufMeta(path, lib);
    } catch {
      // unreadable/corrupt file still lists, with null fields
    }
    out.push({ path, fileName: basename(path), sizeBytes: size, ...meta });
  }
  return out.sort((a, b) => a.fileName.localeCompare(b.fileName));
}
