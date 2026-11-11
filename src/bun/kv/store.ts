// feature 010: file-based KV snapshot store. Manifest ($dir/index.json)
// is the only source of truth — a .kv blob without an entry is an
// orphan, an entry without a blob is missing. Write protocol (engine):
// shim-saves to .tmp → rename to .kv → store.save() rewrites manifest.
// A crash anywhere leaves no entry or a torn .tmp; ctor sweeps both.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
  SnapshotClearResult,
  SnapshotPolicy,
  SnapshotStats,
} from "../../shared/types";
import { kvDir } from "../store/paths";

export const DEFAULT_SNAPSHOT_POLICY: SnapshotPolicy = {
  enabled: true,
  maxBytes: 2_147_483_648, // 2 GiB
};

export interface SnapshotEntry {
  key: string; // "<convId>/<roleKey>"
  convId: string;
  roleKey: string; // "main" | "planner" | "executor"
  modelPath: string;
  fingerprint: string; // library.modelFingerprint
  ctxSize: number; // n_ctx at save — mismatch → discard
  file: string; // blob basename
  sizeBytes: number;
  updatedAt: string;
}

export const entryKey = (convId: string, roleKey: string) =>
  `${convId}/${roleKey}`;

const fileName = (key: string) => key.replace(/[^\w.-]+/g, "_") + ".kv";

interface Manifest {
  entries: SnapshotEntry[];
}

export class SnapshotStore {
  private entries = new Map<string, SnapshotEntry>();
  private manifestPath: string;

  constructor(
    readonly dir: string = kvDir(),
    // live-synced from settings.snapshot on each access (feature 010)
    public policy: SnapshotPolicy = DEFAULT_SNAPSHOT_POLICY,
  ) {
    mkdirSync(dir, { recursive: true });
    this.manifestPath = join(dir, "index.json");
    try {
      const m = JSON.parse(readFileSync(this.manifestPath, "utf8")) as Manifest;
      for (const e of m.entries ?? []) this.entries.set(e.key, e);
    } catch {
      /* missing/corrupt manifest → empty */
    }
    this.sweep();
  }

  private sweep(): void {
    const live = new Set<string>();
    for (const [k, e] of this.entries) {
      // entry without blob → treated as missing
      if (existsSync(join(this.dir, e.file))) live.add(e.file);
      else this.entries.delete(k);
    }
    for (const f of readdirSync(this.dir)) {
      if (f === "index.json") continue;
      // torn .tmp writes + .kv blobs with no entry are garbage
      if (f.endsWith(".tmp") || !live.has(f)) rmSync(join(this.dir, f));
    }
  }

  private flush(): void {
    const tmp = this.manifestPath + ".tmp";
    writeFileSync(tmp, JSON.stringify({ entries: [...this.entries.values()] }));
    renameSync(tmp, this.manifestPath);
  }

  blobPath(key: string): string {
    return join(this.dir, fileName(key));
  }

  tmpPath(key: string): string {
    return join(this.dir, fileName(key) + ".tmp");
  }

  /** Call after the blob has been renamed into place. */
  save(e: Omit<SnapshotEntry, "file" | "sizeBytes" | "updatedAt">): void {
    if (!this.policy.enabled) return;
    const file = fileName(e.key);
    const sizeBytes = statSync(join(this.dir, file)).size;
    const prior = this.entries.get(e.key);
    this.entries.set(e.key, {
      ...e,
      file,
      sizeBytes,
      updatedAt: new Date().toISOString(),
    });
    if (prior && prior.file !== file) rmSync(join(this.dir, prior.file), { force: true });
    this.enforce();
    this.flush();
  }

  /** Valid snapshot path for (key, model fingerprint, ctxSize) or null. */
  lookup(key: string, fingerprint: string, ctxSize: number): string | null {
    if (!this.policy.enabled) return null;
    const e = this.entries.get(key);
    if (!e || e.fingerprint !== fingerprint || e.ctxSize !== ctxSize)
      return null;
    const p = join(this.dir, e.file);
    if (!existsSync(p)) {
      this.entries.delete(key);
      this.flush();
      return null;
    }
    return p;
  }

  /** Caller confirms a successful restore — bumps LRU recency. */
  touch(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    e.updatedAt = new Date().toISOString();
    this.flush();
  }

  private enforce(): void {
    if (this.policy.maxBytes <= 0) return;
    let total = 0;
    for (const e of this.entries.values()) total += e.sizeBytes;
    if (total <= this.policy.maxBytes) return;
    // LRU = oldest updatedAt first
    const byAge = [...this.entries.values()].toSorted((a, b) =>
      a.updatedAt.localeCompare(b.updatedAt),
    );
    for (const e of byAge) {
      if (total <= this.policy.maxBytes) break;
      total -= e.sizeBytes;
      this.entries.delete(e.key);
      rmSync(join(this.dir, e.file), { force: true });
    }
  }

  stats(): SnapshotStats {
    let usedBytes = 0;
    for (const e of this.entries.values()) usedBytes += e.sizeBytes;
    return {
      count: this.entries.size,
      usedBytes,
      maxBytes: this.policy.enabled ? this.policy.maxBytes : 0,
    };
  }

  clear(): SnapshotClearResult {
    let freedBytes = 0;
    for (const e of this.entries.values()) {
      freedBytes += e.sizeBytes;
      rmSync(join(this.dir, e.file), { force: true });
    }
    const removed = this.entries.size;
    this.entries.clear();
    this.flush();
    return { removed, freedBytes };
  }
}
