# Tasks: Startup Model Selection

**Input**: Design documents from `/specs/018-startup-model-select/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/startup-prompt.md

**Tests**: lightweight — the trigger is a status-derived renderer effect; covered by a headless state test plus the existing suite.

## Phase 1: Setup

- [x] T001 Branch `018-startup-model-select` created; spec/plan/research/data-model/contracts/quickstart written under `specs/018-startup-model-select/`

## Phase 2: Foundational

- [x] T002 Verify the terminal-status signal the prompt keys on: confirm `model.status` reconciliation on mount plus `model.progress` events give `modelStatus` values `"unloaded" | "loading" | "ready" | "error"` in `src/renderer/src/features/chat/use-chat.ts` (research D1 — no new RPC).

## Phase 3: US1 — First-Launch Model Prompt (P1)

Goal: no usable default at startup → model-selection surface opens
automatically; a selection persists the default and reaches chat-ready.

Independent test: fresh `APP_DATA_DIR` → library opens unclicked → pick a
model → ready; relaunch → no prompt (quickstart S1/S2).

- [x] T003 [US1] Add session-only `startupPromptDismissed` state + auto-open effect in `src/renderer/src/features/chat/ChatPage.tsx`: when `modelStatus` settles to `"unloaded"` or `"error"` (never `"loading"`, FR-006/FR-007) and the flag is false, set `libraryOpen = true`; on successful `loadModel`/library close-without-load, set the flag so it never re-opens this session (FR-001/FR-004). **Hydration gate (U1)**: `modelStatus` initializes to `"unloaded"` before `model.status` reconciliation — evaluate the trigger only after the first `model.status` response (add a `modelStatusHydrated` flag set by the bootstrap effect in `use-chat.ts`, or an equivalent settled-status signal) so a configured-model boot never flashes the prompt. **Fire-once (U2)**: latch the evaluation so the trigger runs once at startup — a later mid-session `unloaded`/`error` with `dismissed=false` must not auto-open (any prior `ready` this session also dismisses it)
- [x] T004 [US1] Ensure the dismiss path (drawer close / click-away) sets `startupPromptDismissed` and leaves the existing "No model is loaded" banner + manual picker intact in `src/renderer/src/features/chat/ChatPage.tsx` (FR-004, SC-003)
- [x] T005 [US1] Headless test in `tests/renderer/` (new file e.g. `startup-prompt.test.ts`) asserting the trigger predicate: `unloaded`/`error` → open; `loading`/`ready` → no open; dismissed → stays closed; **pre-hydration `unloaded` → no open** (U1 regression); **post-`ready` mid-session `error` → no open** (U2 regression) (extract the predicate to a testable pure helper if the effect can't be driven headlessly)

## Phase 4: US2 — No Models Available (P2)

Goal: empty library still offers the download path (FR-005).

Independent test: `MODELS_DIR` empty + no `activeModelPath` → library opens
with the download form visible (quickstart S3).

- [x] T006 [US2] Verify `src/renderer/src/features/models/ModelLibrary.tsx` renders the download/import affordance with an empty model list; if it early-returns on empty, remove that guard so the download form always shows
- [x] T007 [US2] Verify a successful `model.download` flow ends in a load/ready transition that resolves the prompt (download counts as selection); patch the post-download path if it leaves `modelStatus` non-ready

## Phase 5: Polish & Validation

- [x] T008 Run `bun test ./tests`, `bun run typecheck`, `bun run lint`, `bun run build:renderer` — all green
- [x] T009 Walk quickstart scenarios S1–S6 against `bun run dev`; record outcomes in `specs/018-startup-model-select/validation.md`

## Dependencies

- T002 → T003 (needs the status signal confirmed)
- T003 → T004 → T005 (same file / same behavior)
- T006/T007 independent of each other; both after T003 (need the auto-open)
- T008 → T009

## Parallel opportunities

- T006 ∥ T007 (different concerns; T006 only conflicts if it touches
  download-completion code in the same file)

## Implementation strategy

- MVP = Phase 3 (T003–T005): the auto-open + dismiss covers the P1 story
  end-to-end.
- Phase 4 is a small increment (likely verification-only).
