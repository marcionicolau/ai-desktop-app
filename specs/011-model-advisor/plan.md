# Implementation Plan: Model Advisor (Benchmark Panel)

**Branch**: `011-model-advisor` | **Spec**: [spec.md](spec.md)
**Status**: Ready for tasks

## Summary

Measured, persisted per-model performance (tok/s + resident memory from a
bounded benchmark run), live free-memory fit verdicts, and a fusion
combined-fit check — surfaced inside the existing Library and Roles
surfaces, not a new window. All measurement stays main-process behind
typed RPC; verdicts are computed on demand, never cached.

## Technical Context

- **Benchmark**: reuse `deps.engine.loadModel` + `generate` with a fixed
  bounded prompt and a hard token/wall-time cap. RSS delta via
  `process.memoryUsage().rss` sampled before load and at generation end.
- **Persistence**: `dataDir()/benchmarks.json`, keyed by
  `fileName:sizeBytes` fingerprint (stable across restarts; a changed
  file gets a new fingerprint automatically).
- **Free memory**: `os.freemem()` read live inside `model.advise`.
- **Single-flight**: benchmark refuses while `engine.isGenerating()` or
  a benchmark is already running (`BUSY`).
- **Model swapping**: benchmark loads the target model via the engine,
  then restores the previously-loaded model if one was bound
  (`settings.activeModelPath`).

## Constitution Check

| Principle | Verdict |
|---|---|
| Typed RPC only (renderer never touches fs/native) | ✅ new `model.benchmark` + `model.advise` requests |
| Unsafe code behind shim/FFI boundary | ✅ no FFI changes; RSS via `process.memoryUsage` |
| Local/offline | ✅ no network |
| No fabricated data | ✅ unmeasured rows show "not measured"; verdicts flag estimated vs measured basis |

## Design Decisions (see research.md)

- **D1** — one benchmark = load → bounded generate → measure → restore.
  A second engine instance would double residency and corrupt the RSS
  delta; the engine is single-flight by design.
- **D2** — fingerprint `fileName:sizeBytes`, not a hash (hashing a
  6 GB GGUF costs seconds on every scan for negligible benefit).
- **D3** — benchmark ctx = shim default (`lls_ctx_create`), no ctx-size
  FFI plumbing for this feature.
- **D4** — recommended ctx = `min(contextTrain, largest pow2 ctx where
  fileSize + kvPerToken·ctx ≤ free − headroom)`; `kvPerToken` derived
  from measured peak vs file size (flagged estimated) or a
  conservative default when unmeasured.
- **D5** — fusion verdict = sequential peak (`max`) and combined
  residency (`sum`), computed from role bindings resolved via
  `RolesService.bindingPath`.

## File Layout

```
src/bun/advisor/
  benchmark.ts     bounded run + RSS sampling + record persistence
  verdicts.ts      freeMem, fit verdict, recommendedCtx, fusion combine
  store.ts         benchmarks.json load/save, fingerprint keys
tests/advisor/     benchmark + verdict unit tests (fake engine, fake mem)
tests/rpc/advisor.test.ts   BUSY gate, advise shape, persistence
src/renderer/src/features/models/ModelLibrary.tsx   per-row benchmark
src/renderer/src/features/roles/FusionControls.tsx  combined-fit line
```

## Contract Delta (contracts/rpc.md)

- `model.benchmark` `{path}` → `{record: BenchmarkRecord}` — `BUSY`
  while generating/benchmarking, `MODEL_NOT_FOUND` on bad path.
- `model.advise` `{plannerTag?, executorTag?}` → `{models: [{path,
  benchmark?, verdict, recommendedCtx, basis}], fusion?: {...}}` —
  computed live, no model load.
- `BenchmarkRecord = {fingerprint, tokensPerSec, peakBytes, measuredAt}`,
  `verdict = "fits" | "tight" | "wontfit"`, `basis = "measured" | "estimated"`.

## Risks

- **RSS noise**: GC/alloc jitter can shrink the delta → take max(rss
  during generate, rss at end) minus rss before load; floor at file
  size. Re-benchmark overwrites, so noise self-corrects on refresh.
- **Slow models**: a 14B Q3 on CPU may hit the wall-time cap → record
  partial tok/s anyway (still measured, flag `partial: true`).
