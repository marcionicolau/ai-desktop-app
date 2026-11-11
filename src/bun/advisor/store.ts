// feature 011: benchmark persistence — dataDir()/benchmarks.json keyed by
// fingerprint. Tolerant load: missing/corrupt file -> empty map (advisory
// data; never fail the app over it).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../store/paths";
import type { BenchmarkRecord } from "../../shared/types";

export function fingerprint(fileName: string, sizeBytes: number): string {
  return `${fileName}:${sizeBytes}`;
}

function file(): string {
  return join(dataDir(), "benchmarks.json");
}

export function loadBenchmarks(): Record<string, BenchmarkRecord> {
  try {
    if (!existsSync(file())) return {};
    const raw: unknown = JSON.parse(readFileSync(file(), "utf8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return {};
    }
    return raw as Record<string, BenchmarkRecord>;
  } catch {
    return {};
  }
}

export function saveRecord(r: BenchmarkRecord): void {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const all = loadBenchmarks();
  all[r.fingerprint] = r;
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, JSON.stringify(all, null, 2));
  renameSync(tmp, file()); // atomic-ish swap
}
