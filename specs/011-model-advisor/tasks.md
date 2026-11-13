# Tasks: Model Advisor (Benchmark Panel)

**Input**: Design documents from `/specs/011-model-advisor/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/rpc.md

## Format: `[ID] [P?] [Story] Description`

## Phase 1 — Foundational

- [x] T001 (FR-009) Add shared types `BenchmarkRecord` (`{fingerprint, tokensPerSec,
  peakBytes, measuredAt, partial?}`), `FitVerdict` (`"fits"|"tight"|"wontfit"`),
  `ModelAdvise`, `FusionAdvise` to `src/shared/types.ts`.
- [x] T002 (FR-006, FR-009) Add `model.benchmark` (`{path}` → `{record}`) and `model.advise`
  (`{plannerTag?, executorTag?}` → `{models, fusion?}`) to the RPC contract in
  `src/shared/rpc-contract.ts`; add `"ENGINE_BUSY"` to the `EngineError` codes used
  for refusals.
- [x] T003 (FR-002) PREREQ: branch predates the 008+009 merges — rebase onto `main`
  before touching `handlers.ts`/`roles.ts`. Create
  `src/bun/advisor/store.ts`: `fingerprint(fileName, sizeBytes)` →
  `"name:size"`; `loadBenchmarks()`/`saveRecord(r)` on
  `dataDir()/benchmarks.json` (atomic write, tolerate missing/corrupt file →
  empty map).
- [x] T004 (FR-003, FR-004, FR-005, FR-010) Create `src/bun/advisor/verdicts.ts` — pure functions:
  `fitVerdict(basisBytes, freeBytes)` → fits/tight/wontfit with headroom
  rule (headroom = max(1 GiB, 15% of total)); `recommendedCtx(fileSize,
  kvPerToken, free, contextTrain)` → pow2 floor; `kvPerToken(fileSize,
  peakBytes, benchCtx)`; `fusionFit(peakA, peakB)` → `{sequentialPeak: max,
  combined: sum}`. All take mem as params — never read os.freemem inside
  (injectable for tests, per D4).
- [x] T005 (FR-002) [P] Add `tests/advisor/store.test.ts`: fingerprint format; save →
  load round-trip; missing file → `{}`; corrupt JSON → `{}`; record for
  `name:newsize` is a distinct key.
- [x] T006 (FR-003, FR-004, FR-005) [P] Add `tests/advisor/verdicts.test.ts`: verdict boundaries
  (fits/tight/wontfit at headroom edges); `recommendedCtx` clamps to
  `contextTrain` and pow2; kvPerToken derivation; `fusionFit` max/sum.

## Phase 2 — US1 (P1): benchmark → measured figures that persist

**Goal**: Run a bounded benchmark per model; row shows measured tok/s +
memory that survives restart.

**Independent Test**: `model.benchmark` on a fake engine produces a record;
`benchmarks.json` reloads it.

- [x] T007 (FR-001, FR-007) [US1] Create `src/bun/advisor/benchmark.ts`: `runBenchmark(deps
  {engine, loadModel restore path})` — fixed prompt constant, `maxTokens:
  128`, 25 s wall cap via `engine.stop()`; RSS = `process.memoryUsage().rss`
  sampled before load + every 250 ms during generate;
  `peakBytes = max(maxRss − rssBefore, sizeBytes)`; `tokensPerSec =
  tokens/elapsed`; `partial: true` when capped; unload + restore previous
  active model afterward (research D1).
- [x] T008 (FR-001, FR-006, FR-009) [US1] Add `model.benchmark` handler in `src/bun/rpc/handlers.ts`:
  refuse `ENGINE_BUSY` when `engine.isGenerating()` or a benchmark is already
  running (module-level flag); `MODEL_NOT_FOUND` on missing path; emit
  `model.progress` loading/ready/error phases; persist record via
  `saveRecord` before returning.
- [x] T009 (FR-001, FR-006) [US1] Add `tests/rpc/advisor.test.ts`: benchmark → record shape +
  persisted file; second concurrent benchmark → `ENGINE_BUSY`; benchmark while
  `isGenerating()` → `ENGINE_BUSY`; missing path → `MODEL_NOT_FOUND`; partial flag;
  absolute-path (non-library) benchmark works identically (spec edge case).
  on capped run.
- [x] T010 (FR-001, FR-008) [US1] `src/renderer/src/features/models/ModelLibrary.tsx`: per-row
  "not measured — run benchmark" or measured `tok/s` + memory + `▶` button
  (disabled/spinning while a benchmark runs); SC-001 wall-time ≤ 30 s hint
  in button title.

## Phase 3 — US2 (P2): fit verdicts + fusion combined fit

**Goal**: Live fits/tight/won't-fit per model + recommended ctx; bound
fusion pair evaluated together.

**Independent Test**: `model.advise` returns verdicts matching a stubbed
freeMem without loading any model.

- [x] T011 (FR-003, FR-004, FR-005, FR-010) [US2] Add `model.advise` handler in `src/bun/rpc/handlers.ts`:
  `scanModels()` + live `os.freemem()`; per model →
  `{path, fileName, benchmark?, verdict, recommendedCtx, basis, basisBytes}`;
  basis `"measured"` when a fingerprinted record exists else `"estimated"`
  (fileSize-derived kvPerToken per research D4); `fusion` object only when
  both `plannerTag`/`executorTag` resolve via `RolesService.bindingPath`.
- [x] T012 (FR-003, FR-010) [US2] Extend `tests/rpc/advisor.test.ts`: advise returns all
  library models with `estimated` basis pre-benchmark; `measured` basis
  after; fusion combine on bound tags (fake roles); verdicts shift when
  freeMem param changes (live, not cached).
- [x] T013 (FR-003, FR-004, FR-008) [US2] `ModelLibrary.tsx`: verdict badge (fits/tight/won't fit
  colors) + `ctx ≤ N` recommendation + `measured`/`est.` basis label per
  row.
- [x] T014 (FR-005, FR-008) [US2] `src/renderer/src/features/roles/FusionControls.tsx`:
  combined-fit line — sequential peak + combined residency + verdict when
  planner/executor resolve to different models.

## Phase 4 — Polish

- [x] T015 Write `specs/011-model-advisor/validation.md` mapping
  quickstart VS-1…VS-3 to test evidence + gates; note SC-001 (±20% tok/s)
  is hardware-validated, not unit-testable on the fake engine.
- [x] T016 Run all gates (`bun test`, typecheck, lint, build); append module
  notes to `AGENTS.md` (advisor/ dir, benchmarks.json location, measured
  vs estimated basis convention).

## Dependencies

- T001–T006 foundational; T007+ need T001–T004.
- US1 (T007–T010) → benchmark + persistence works alone = MVP.
- US2 (T011–T014) needs the store (T003) + verdicts (T004) but not the
  benchmark runner itself.
- T015/T016 last.

## Parallel Opportunities

- T005 ‖ T006 (separate test files).
- T013 ‖ T014 (separate renderer files).
