// Attachment registry (feature 009). File content is read + validated
// here in the main process and persisted per-id — the renderer only ever
// sees metadata (FR-010). Format: one JSON file per attachment at
// dataDir()/attachments/<id>.json.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { basename, join, resolve as resolvePath } from "node:path";
import { dataDir } from "../store/paths";
import { EngineError } from "../llama/engine";
import type { Conversation } from "../../shared/types";

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB per-file read cap (D5)

export interface StoredAttachment {
  id: string;
  path: string;
  fileName: string;
  sizeBytes: number;
  content: string;
}

export interface PickResult {
  picked: Array<{ id: string; path: string; fileName: string; sizeBytes: number }>;
  rejected: Array<{ fileName: string; reason: string }>;
}

function dir(): string {
  const d = join(dataDir(), "attachments");
  mkdirSync(d, { recursive: true });
  return d;
}

const fileFor = (id: string) => join(dir(), `${id}.json`);

// path -> id, for same-session dedup (FR-007)
const byPath = new Map<string, string>();

function validate(
  fileName: string,
  bytes: Uint8Array,
): string | null {
  if (bytes.byteLength > MAX_FILE_BYTES) {
    return `over the ${MAX_FILE_BYTES / 1024 / 1024} MiB per-file limit`;
  }
  if (bytes.includes(0)) return "binary file (contains NUL bytes)";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "not UTF-8 text";
  }
  return null;
}

const bad = (msg: string): never => {
  throw new EngineError("INVALID_PARAMS", msg);
};

export function storeAttachment(
  path: string,
):
  | { meta: { id: string; path: string; fileName: string; sizeBytes: number } }
  | { error: string } {
  const abs = resolvePath(path);
  const fileName = basename(abs);
  const existing = byPath.get(abs);
  if (existing && existsSync(fileFor(existing))) {
    const s = readAttachment(existing);
    return { meta: { id: existing, path: abs, fileName, sizeBytes: s.sizeBytes } };
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(abs));
  } catch (e) {
    return { error: `unreadable: ${e instanceof Error ? e.message : String(e)}` };
  }
  const why = validate(fileName, bytes);
  if (why) return { error: why };
  const id = crypto.randomUUID();
  const rec: StoredAttachment = {
    id,
    path: abs,
    fileName,
    sizeBytes: bytes.byteLength,
    content: new TextDecoder().decode(bytes),
  };
  Bun.write(fileFor(id), JSON.stringify(rec));
  byPath.set(abs, id);
  return {
    meta: { id, path: abs, fileName, sizeBytes: rec.sizeBytes },
  };
}

export function pickAndStore(paths: string[]): PickResult {
  const picked: PickResult["picked"] = [];
  const rejected: PickResult["rejected"] = [];
  for (const p of paths) {
    const r = storeAttachment(p);
    if ("error" in r) rejected.push({ fileName: basename(p), reason: r.error });
    else picked.push(r.meta);
  }
  return { picked, rejected };
}

export function readAttachment(id: string): StoredAttachment {
  const f = fileFor(id);
  if (!existsSync(f)) bad(`unknown attachment id: ${id}`);
  return JSON.parse(readFileSync(f, "utf8")) as StoredAttachment;
}

export function resolveMany(ids: string[]): StoredAttachment[] {
  return ids.map(readAttachment);
}

// remove attachment files referenced only by the deleted conversation
// (attachment ids are unique per pick, so conv-scoped gc is exact)
export function gcFor(conversation: Conversation): void {
  for (const m of conversation.messages) {
    for (const a of m.attachments ?? []) {
      try {
        unlinkSync(fileFor(a.id));
      } catch {
        // already gone
      }
    }
  }
  // prune stale dedup entries whose files vanished
  for (const [p, id] of byPath) {
    if (!existsSync(fileFor(id))) byPath.delete(p);
  }
}
