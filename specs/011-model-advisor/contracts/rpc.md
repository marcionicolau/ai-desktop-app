# Contract Delta — 011-model-advisor

Two new requests, no event changes.

## `model.benchmark`

```ts
params:  { path: string }                // library or external abs path
response: { record: BenchmarkRecord }
errors:  ENGINE_BUSY              engine generating or benchmark already running
         MODEL_NOT_FOUND path missing/unreadable
```

Bounded: fixed prompt, `maxTokens: 128`, 25 s wall cap. Swaps the
active model (unloads → benchmarks → restores previous). Emits the
existing `model.progress` phases for UI feedback.

## `model.advise`

```ts
params:  { plannerTag?: string; executorTag?: string }
response: {
  models: ModelAdvise[];    // one per library model, live verdicts
  fusion?: FusionAdvise;    // only when both tags resolve to models
}
```

Never loads a model — reads live `os.freemem()`, scan, and the
benchmark cache. Verdicts degrade to `basis: "estimated"` (file-size
heuristic) until a benchmark exists.

## Invariants

- `model.benchmark` is the only mutating call; `model.advise` is pure.
- Nothing below crosses to the renderer except these typed shapes —
  RSS/freeMem never leave the main process raw.
- Advisor is informational: `wontfit` never blocks `model.load`.
