# Data Model — 011-model-advisor

## BenchmarkRecord (persisted)

`dataDir()/benchmarks.json`:

```json
{
  "Qwen2.5-14B-Instruct-Q3_K_S.gguf:6659596416": {
    "fingerprint": "Qwen2.5-14B-Instruct-Q3_K_S.gguf:6659596416",
    "tokensPerSec": 12.4,
    "peakBytes": 7381975040,
    "measuredAt": "2025-11-25T17:40:00.000Z",
    "partial": false
  }
}
```

- Key + `fingerprint` = `${fileName}:${sizeBytes}` (D2).
- `partial: true` when the wall-time cap cut the run short — still a
  real measurement, flagged for display.
- `peakBytes` = max-RSS delta over the run, floored at `sizeBytes`.

## ModelAdvise (transient, never persisted)

Returned by `model.advise`, recomputed each call:

```ts
{
  models: Array<{
    path: string;              // resolved absolute
    fileName: string;
    benchmark?: BenchmarkRecord;   // absent = not measured
    verdict: "fits" | "tight" | "wontfit";
    recommendedCtx: number;        // tokens, pow2
    basis: "measured" | "estimated"; // how verdict was derived
    basisBytes: number;            // memory figure behind the verdict
  }>;
  fusion?: {                     // only when both tags resolve
    planner: string; executor: string;
    sequentialPeakBytes: number;   // max(a, b)
    combinedBytes: number;         // a + b
    verdict: "fits" | "tight" | "wontfit";
  };
}
```

## Shared types

`src/shared/types.ts` gains `BenchmarkRecord`, `FitVerdict`,
`ModelAdvise`, `FusionAdvise` — renderer imports them, no content.

## Relationships

- `BenchmarkRecord` ⟷ `ModelMeta` on `fileName + sizeBytes`.
- Fusion verdict ⟷ `RolesService` bindings (`planner`/`executor` tags).
- No conversation/message schema changes; benchmarks.json is
  independent of the store.
