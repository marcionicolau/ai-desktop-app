// feature 023: script registry (data-model.md). Registry lives in
// dataDir()/scripts.json; stored sources at dataDir()/scripts/<slug>.<ext>
// so deleting the user's original file can't break an entry.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join } from "node:path";
import type { ScriptEntry, ScriptRuntimeKind } from "../../shared/types";
import { scriptsDir, scriptsFile } from "../store/paths";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EXT: Record<ScriptRuntimeKind, string> = { python: ".py", r: ".R" };

export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s);
}

function atomicWrite(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, file);
}

export class ScriptStore {
  private load(): ScriptEntry[] {
    try {
      const v = JSON.parse(readFileSync(scriptsFile(), "utf8"));
      return Array.isArray(v) ? (v as ScriptEntry[]) : [];
    } catch {
      return [];
    }
  }

  private save(entries: ScriptEntry[]): void {
    atomicWrite(scriptsFile(), entries);
  }

  list(): ScriptEntry[] {
    return this.load();
  }

  get(id: string): ScriptEntry | null {
    return this.load().find((e) => e.id === id) ?? null;
  }

  upsert(entry: ScriptEntry): void {
    const all = this.load().filter((e) => e.id !== entry.id);
    all.push(entry);
    this.save(all);
  }

  delete(id: string): boolean {
    const all = this.load();
    const next = all.filter((e) => e.id !== id);
    if (next.length === all.length) return false;
    this.save(next);
    // stored source goes with the entry
    for (const ext of [".py", ".R", ".r"]) {
      try {
        rmSync(join(scriptsDir(), id + ext));
      } catch {
        /* absent */
      }
    }
    return true;
  }

  // stored source path for an entry (id + runtime → file name)
  sourcePath(entry: Pick<ScriptEntry, "id" | "runtime">): string {
    return join(scriptsDir(), entry.id + EXT[entry.runtime]);
  }

  writeSource(id: string, runtime: ScriptRuntimeKind, text: string): void {
    mkdirSync(scriptsDir(), { recursive: true });
    writeFileSync(this.sourcePath({ id, runtime }), text, "utf8");
  }

  // script code for a call — stored file or external path; null when the
  // source can't be read (callers surface "source unavailable")
  readSource(entry: ScriptEntry): string | null {
    try {
      if (entry.source.kind === "stored") {
        return readFileSync(this.sourcePath(entry), "utf8");
      }
      const p = entry.source.path;
      if (extname(p) === "" || !existsSync(p)) return null;
      return readFileSync(p, "utf8");
    } catch {
      return null;
    }
  }
}
