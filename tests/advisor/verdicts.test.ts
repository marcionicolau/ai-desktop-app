// T006: verdict boundary math — pure functions, memory injected
import { test, expect } from "bun:test";
import {
  fitVerdict,
  fusionFit,
  headroom,
  kvPerToken,
  recommendedCtx,
} from "../../src/bun/advisor/verdicts";

const GIB = 1024 ** 3;

test("headroom = max(1 GiB, 15% total)", () => {
  expect(headroom(4 * GIB)).toBe(GIB); // 15% of 4 GiB < 1 GiB
  expect(headroom(32 * GIB)).toBe(Math.floor(32 * GIB * 0.15));
});

test("verdict boundaries at headroom edges", () => {
  const hr = GIB;
  expect(fitVerdict(2 * GIB, 8 * GIB, hr)).toBe("fits");
  expect(fitVerdict(7.5 * GIB, 8 * GIB, hr)).toBe("tight"); // fits but inside headroom
  expect(fitVerdict(9 * GIB, 8 * GIB, hr)).toBe("wontfit");
});

test("kvPerToken derives from measured peak; floor + unmeasured fallback", () => {
  // peak 6 GiB over a 5 GiB file at ctx 2048 -> 0.5 MiB/token
  expect(kvPerToken(5 * GIB, 6 * GIB, 2048)).toBeCloseTo((1 * GIB) / 2048);
  // implausibly small -> 32 KiB floor
  expect(kvPerToken(5 * GIB, 5 * GIB, 2048)).toBe(256 * 1024); // zero kv -> fallback
});

test("recommendedCtx: pow2 floor, contextTrain cap, headroom-aware", () => {
  // 4 GiB file, 0.5 MiB/tok, 10 GiB free, 1 GiB headroom -> 5 GiB avail -> 10240 tok -> pow2 8192
  const ctx = recommendedCtx(4 * GIB, 0.5 * 1024 * 1024, 10 * GIB, GIB, null);
  expect(ctx).toBe(8192);
  // contextTrain caps below the computed pow2
  expect(recommendedCtx(1 * GIB, 1024, 64 * GIB, GIB, 4096)).toBe(4096);
  // no room at all -> 0
  expect(recommendedCtx(10 * GIB, 1024, 10 * GIB, GIB, null)).toBe(0);
});

test("fusionFit: sequential peak = max, combined = sum", () => {
  expect(fusionFit(6 * GIB, 3 * GIB)).toEqual({
    sequentialPeakBytes: 6 * GIB,
    combinedBytes: 9 * GIB,
  });
});
