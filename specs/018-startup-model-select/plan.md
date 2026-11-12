# Implementation Plan: Startup Model Selection

**Branch**: `018-startup-model-select` | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/018-startup-model-select/spec.md`

## Summary

On startup with no usable default model, automatically present the existing
model-selection surface (the `ModelLibrary` drawer, which covers both "pick
an installed file" and "download a model") instead of leaving the user at a
passive "No model is loaded" banner. Pure renderer-side trigger — the main
process already emits `model.progress` bootstrap events and answers
`model.status`; no RPC changes.

## Technical Context

**Language/Version**: TypeScript strict (Bun main + React 19 renderer)

**Primary Dependencies**: React, Tailwind v4, existing RPC (`model.status`,
`model.load`, `model.list`, `model.download`), `use-chat` reducer

**Storage**: `settings.activeModelPath` (existing JSON settings store) —
unchanged; no new persisted state (dismissal is session-only)

**Testing**: `bun test ./tests` (renderer reducer-level tests where
practical; the auto-open trigger is a thin effect, verified by headless
status-injection tests)

**Target Platform**: Electrobun desktop app (Linux/macOS/Windows)

**Project Type**: desktop-app

**Performance Goals**: N/A — one-shot startup branch, no hot path

**Constraints**: Must not prompt while a configured model is loading; must
not re-prompt within a session after dismissal; must not regress the
configured-model fast path (SC-004)

**Scale/Scope**: ~2 renderer files touched (`use-chat.ts` trigger state +
`ChatPage.tsx` auto-open effect); optional small test file

## Constitution Check

- **I. Local-First**: ✅ no inference-path change.
- **II. Process Boundaries**: ✅ renderer-only change using existing typed
  RPC (`model.status` reconciliation already on mount); no new IPC.
- **III. Strict TS**: ✅ `ModelStatus` union already typed.
- **IV. (testing/persistence principles, if present)** — dismissal flag is
  session-only component state, so no new persistence invariants.

No violations; no justification needed.

## Phase 0: Research

All decisions resolve to existing mechanisms — see `research.md`:

- Trigger signal = `modelStatus` transitions (`unloaded`/`error` after
  bootstrap) — no new RPC needed (`model.status` already reconciles on mount).
- Selection surface = `ModelLibrary` drawer (covers empty-library →
  download per FR-005, since the picker file dialog alone can't offer a
  download path).
- "No usable model" = `unloaded` OR `error` at startup (FR-007).
- Dismissal = session-only flag; not persisted (no "don't ask again"
  requirement in spec).

## Phase 1: Design

Artifacts: `data-model.md` (state additions), `contracts/startup-prompt.md`
(trigger contract), `quickstart.md` (validation scenarios).
