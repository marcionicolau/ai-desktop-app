# Validation — 011-model-advisor

Automated evidence is in `tests/advisor/` and `tests/rpc/advisor.test.ts`
(18 tests, all passing — 185 total suite-wide). Note: **SC-001's ±20%
tok/s repeatability is hardware-validated, not unit-testable** on the
fake engine — the bound itself (128 tokens, 25 s wall cap) is asserted
in code and `partial` flags any capped run.

## VS-1 Benchmark a model

- `model.benchmark` loads the target through the single-flight engine,
  runs a fixed prompt capped at 128 tokens / 25 s, samples RSS every
  250 ms, and persists `BenchmarkRecord` to `benchmarks.json` keyed by
  `fileName:sizeBytes` — `benchmark persists a measured record`.
- `peakBytes` floors at file size (RSS noise under-reads on short runs);
  capped runs record `partial: true` — `partial run records partial`.
- The previous active model reloads afterward (best-effort restore).
- UI: ModelLibrary rows show `not measured` + a ▶ Gauge button →
  spinner while running → measured `tok/s` + memory afterward.

## VS-2 Fit verdicts

- `model.advise` reads live `os.freemem()`/`totalmem()` — verdicts are
  recomputed per call, never cached (FR-010).
- Rows show fits / tight / won't fit + `ctx ≤ N` + a `measured`/`est.`
  basis label — `pre-benchmark rows report estimated basis`,
  `post-benchmark … measured basis` (SC-004: persisted across reload).
- Edge cases covered: `ENGINE_BUSY` while generating or a second
  concurrent benchmark; `MODEL_NOT_FOUND` on bad paths; external
  absolute-path models benchmark identically (spec edge case).
- Boundary math (fits/tight/wontfit at headroom edges, pow2 ctx clamp,
  `contextTrain` cap) — `tests/advisor/verdicts.test.ts`.

## VS-3 Fusion combined fit

- `model.advise {plannerTag, executorTag}` resolves bindings through
  `RolesService.resolve` and returns `{sequentialPeakBytes: max,
  combinedBytes: sum, verdict}` — `fusion combine reports sequential
  peak + combined residency` (SC-003: a too-big pair surfaces
  `wontfit`, never "safe").
- `FusionControls` shows `pair: fits · peak X GB · both Y GB` when both
  tags resolve; unbound pairs omit the block.
- Advisor is informational only — `wontfit` never blocks `model.load`
  (spec assumption preserved).

## Gates

- `bun test ./tests` — 185 pass / 0 fail (was 167 at 009: +18 advisor)
- `bun run typecheck` (`tsc --noEmit`) — clean
- `bun run lint` (`oxlint`) — clean
- `hutch run build` — deferred to T016 run
