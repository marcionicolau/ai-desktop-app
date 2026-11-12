# Research: Startup Model Selection

## D1: Where does the startup trigger live?

**Decision**: renderer `use-chat`/`ChatPage`, keyed off `modelStatus`.

**Rationale**: the Bun bootstrap already emits `model.progress`
(`loading`/`ready`/`error`) from `settings.activeModelPath`, and the
renderer reconciles via `model.status` on mount (handlers.ts ~1909). The
"no usable model" condition is exactly `modelStatus === "unloaded"` after
reconciliation (no configured path) or `"error"` at bootstrap (configured
path failed — FR-007). A renderer-side effect is the minimal change and
requires zero RPC surface additions.

**Alternatives considered**: main-process "first-run" flag pushed via a new
RPC — rejected: duplicates the already-reported status and adds contract
surface for no benefit.

## D2: Which selection surface opens automatically?

**Decision**: the `ModelLibrary` drawer, not the bare file-dialog
`pickModel`.

**Rationale**: FR-005 requires a download path when no model files exist;
the file dialog can't offer that. `ModelLibrary` lists installed models and
carries the download form — one surface covers both first-run shapes.

**Alternatives considered**: auto-invoking `model.pick` file dialog —
rejected, strands empty-library users. A new dedicated first-run wizard —
rejected, spec says reuse the model-selection flow.

## D3: Dismissal semantics

**Decision**: session-only boolean; closing the library without a load =
dismissed; never re-opens automatically within the session.

**Rationale**: spec requires dismissibility and "no modal loop" but does
not require cross-session suppression — a user who never picks a model
still has no working chat, so re-prompting next launch is correct.

## D4: "Loading" guard

**Decision**: the auto-open fires only when the status is terminal
(`unloaded`/`error`), never while `loading`.

**Rationale**: prevents the prompt flashing over a valid configured-model
load (spec edge case). The bootstrap emits `loading` before `ready`, so the
effect simply waits for a settled status.
