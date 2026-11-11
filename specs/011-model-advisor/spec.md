# Feature Specification: Model Advisor (Benchmark Panel)

**Feature Branch**: `011-model-advisor`

**Created**: 2025-11-24

**Status**: Draft

**Input**: User description: "Model advisor panel — measured tokens/sec + memory per model, context-size recommendations, and a fusion-pair fit check (two bound models vs free memory), turning heuristic warnings into data."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Per-model measured performance (Priority: P1)

A user opens the model library and sees, per model, measured generation
speed and resident memory — not guesses from file size. A short benchmark
run produces the numbers, which are cached and refreshed on demand.

**Why this priority**: Users choose models blind today; real numbers make
"which model fits this machine" answerable at a glance.

**Independent Test**: Run a benchmark on one model — the library row shows
tok/s and memory figures that persist across restart.

**Acceptance Scenarios**:

1. **Given** a model in the library, **When** the user runs a benchmark,
   **Then** its row shows measured tokens/sec and resident memory.
2. **Given** benchmark data exists, **When** the app restarts, **Then**
   figures persist and are marked as measured (not estimated).

---

### User Story 2 - Fit & context recommendations (Priority: P2)

The advisor recommends a maximum context size per model given available
memory, and flags when a selected model won't fit comfortably. For fusion
conversations it evaluates the bound pair together (sequential memory
peak + combined residency if both stay warm).

**Why this priority**: Prevents the two most common failures — context
over-allocation crashes and fusion OOM — before they happen.

**Independent Test**: On a machine with known free memory, the advisor's
"fits"/"tight"/"won't fit" verdict matches observed load behavior.

**Acceptance Scenarios**:

1. **Given** a model row, **When** the advisor computes fit, **Then** it
   shows a recommended context size and a fit verdict vs current free
   memory.
2. **Given** planner and executor bound to different models, **When**
   viewing fusion settings, **Then** a combined-fit line reports whether
   sequential peak memory is safe and whether both can stay resident.

---

### Edge Cases

- Benchmark while a generation is running: queued/refused with a clear
  reason (single-flight invariant).
- First-run machines with no benchmark data: rows show "not measured —
  run benchmark" rather than fabricated numbers.
- Benchmark itself must be bounded (fixed prompt + capped tokens) so it
  can't runaway-consume the machine.
- Free-memory readings change: verdicts are computed live, not cached.
- External/absolute-path bindings benchmark identically to library files.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to trigger a bounded benchmark run per
  model producing measured tokens/sec and resident memory.
- **FR-002**: Benchmark results MUST persist per model identity (file
  name + fingerprint), and MUST be distinguishable as measured.
- **FR-003**: The advisor MUST compute a live fit verdict per model vs
  current free memory: fits / tight / won't fit.
- **FR-004**: The advisor MUST recommend a maximum context size per model
  derived from measured usage plus a headroom rule.
- **FR-005**: For fusion conversations, the advisor MUST evaluate the
  bound role pair together — sequential peak and combined residency.
- **FR-006**: Benchmark runs MUST respect the single-flight generation
  gate and refuse/queue while a turn is in progress.
- **FR-007**: Benchmarks MUST be bounded in prompt size, token count, and
  wall time.
- **FR-008**: The panel MUST integrate with the existing Roles/Library
  surfaces rather than a separate window.
- **FR-009**: All measurement MUST run in the main process via typed RPC.
- **FR-010**: Fit verdicts MUST be computed from live free-memory reads,
  not cached values.

### Key Entities

- **Benchmark record**: `{ modelFingerprint, tokensPerSec, peakBytes,
  measuredAt }`.
- **Fit verdict**: `{ fits|tight|wontfit, recommendedCtx, basisBytes }`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A benchmark run completes in under 30 seconds and yields
  repeatable tok/s within ±20% across runs.
- **SC-002**: Fit verdicts correctly predict load success/failure in
  100% of validation cases on the dev host.
- **SC-003**: The fusion combined-fit verdict prevents a known-OOM pair
  from being presented as safe.
- **SC-004**: Persisted figures survive restart without re-benchmarking.
- **SC-005**: All existing gates pass and no pre-existing test regresses.

## Assumptions

- Memory figures come from process RSS deltas around a bounded
  benchmark; platform differences are absorbed by re-measurement.
- Advisor is informational: it warns, it does not hard-block loading —
  hard blocking stays a user decision.
