// feature 011: bounded benchmark — load target, fixed prompt, 128-token cap,
// 25 s wall cap via engine.stop(); RSS delta = resident memory (research D1).
// Restores the previously active model afterward.
import { statSync } from "node:fs";
import { basename } from "node:path";
import type { BenchmarkRecord, GenerationParams } from "../../shared/types";
import { fingerprint, saveRecord } from "./store";

const PROMPT = "Explain photosynthesis in one short paragraph.";
const MAX_TOKENS = 128;
const WALL_MS = 25_000;
const SAMPLE_MS = 250;

export interface BenchEngine {
  loadModel(path: string): Promise<{ status: "ready"; name: string }>;
  unloadModel(): void;
  generate(
    prompt: string,
    onToken: (d: string) => void,
    params?: GenerationParams | null,
  ): Promise<{ status: "complete" | "partial"; tokens: number; elapsedMs: number }>;
  stop(): void;
}

const rss = () => process.memoryUsage().rss;

export async function runBenchmark(
  eng: BenchEngine,
  path: string,
  restorePath: string | null,
): Promise<BenchmarkRecord> {
  const sizeBytes = statSync(path).size;
  const rssBefore = rss();
  let peak = rssBefore;
  const sampler = setInterval(() => {
    peak = Math.max(peak, rss());
  }, SAMPLE_MS);

  let res: { status: string; tokens: number; elapsedMs: number };
  try {
    await eng.loadModel(path);
    const timer = setTimeout(() => eng.stop(), WALL_MS);
    try {
      res = await eng.generate(PROMPT, () => {}, {
        maxTokens: MAX_TOKENS,
      } as GenerationParams);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    clearInterval(sampler);
    eng.unloadModel();
    if (restorePath) {
      try {
        await eng.loadModel(restorePath);
      } catch {
        // restore is best-effort — the benchmark record still returns
      }
    }
  }

  const record: BenchmarkRecord = {
    fingerprint: fingerprint(basename(path), sizeBytes),
    tokensPerSec: res.elapsedMs > 0 ? res.tokens / (res.elapsedMs / 1000) : 0,
    // floor at file size — RSS noise can under-read on small runs
    peakBytes: Math.max(peak - rssBefore, sizeBytes),
    measuredAt: new Date().toISOString(),
    ...(res.status === "partial" ? { partial: true } : {}),
  };
  saveRecord(record);
  return record;
}
