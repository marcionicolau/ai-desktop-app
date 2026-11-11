// feature 011: pure verdict math — memory figures are injected (live
// os.freemem() read happens in the handler) so tests stay deterministic.
import type { FitVerdict } from "../../shared/types";

const GIB = 1024 ** 3;

export function headroom(totalBytes: number): number {
  return Math.max(GIB, Math.floor(totalBytes * 0.15));
}

// basis = bytes the model needs resident (peak measured, or estimated).
export function fitVerdict(
  basisBytes: number,
  freeBytes: number,
  headroomBytes: number,
): FitVerdict {
  if (basisBytes + headroomBytes > freeBytes) {
    return basisBytes > freeBytes ? "wontfit" : "tight";
  }
  return "fits";
}

// KV usage scales ~linearly with ctx; derive bytes/token from a measured
// peak (research D4). benchCtx = the ctx the benchmark ran under.
export function kvPerToken(
  fileSize: number,
  peakBytes: number,
  benchCtx: number,
): number {
  const kv = Math.max(0, peakBytes - fileSize);
  const per = kv / Math.max(1, benchCtx);
  // unmeasured or implausibly small -> conservative 7-14B fallback
  return per > 0 ? Math.max(per, 32 * 1024) : 256 * 1024;
}

const pow2floor = (n: number): number => {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
};

// largest pow2 ctx where fileSize + kv·ctx stays inside free − headroom,
// capped at the model's training context.
export function recommendedCtx(
  fileSize: number,
  kvPerTok: number,
  freeBytes: number,
  headroomBytes: number,
  contextTrain: number | null,
): number {
  const cap = contextTrain ?? 32768;
  const avail = freeBytes - headroomBytes - fileSize;
  if (avail <= 0) return 0;
  return Math.min(cap, pow2floor(Math.floor(avail / kvPerTok)));
}

export function fusionFit(
  peakA: number,
  peakB: number,
): { sequentialPeakBytes: number; combinedBytes: number } {
  return {
    sequentialPeakBytes: Math.max(peakA, peakB),
    combinedBytes: peakA + peakB,
  };
}
