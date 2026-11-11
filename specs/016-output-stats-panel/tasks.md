# Tasks — 016-output-stats-panel

## Phase 1 — foundational

- [X] T001 `src/shared/types.ts`: `MetricEntry`; `settings.outputPanel?`.
- [X] T002 `src/shared/rpc-contract.ts`: `metrics.list`/`metrics.clear`
  requests, `metrics.entry` message, `settings.get` response +`outputPanel`,
  `settings.set` params +`outputPanel?`.
- [X] T003 `src/bun/metrics/store.ts` NEW `MetricsStore`: `record(entry)`,
  `list()`, `clear()` → `{removed}`, 500-entry ring, chronological order.
- [X] T004 [P] `tests/bun/metrics.test.ts`: ring cap drops oldest, clear
  idempotent, record→list round-trip, entry shape (preview ≤120).
- [X] T005 `src/bun/llama/engine.ts` + `EngineLike` in handlers:
  `generate` result += `promptTokens` via `lls_token_count(prompt)`;
  update result type in `EngineLike` (`promptTokens?: number`).

## Phase 2 — collection + RPC (US1, P1)

- [X] T006 `src/bun/rpc/handlers.ts`: `metrics?: MetricsStore` dep;
  helper `recordCall({...})` gated on `settings.outputPanel`; single-mode
  path records after `eng.generate` (modelFile = serving slot/fileName,
  tag = attempt role tag, fallback = servedBy==="fallback", preview =
  `current` ≤120 chars); emit `metrics.entry`. Failed/thrown generates
  also record with `status:"failed"` and tokens produced so far (spec
  edge case) — record inside the turn's catch path too.
- [X] T007 `src/bun/llama/fusion.ts`: `onMetric?: (e: MetricEntry)=>void`
  in `FusionTurnOpts`; record inside `runPhase` after `genPhase` with
  `roleKey: kind`, `modelFile: role.fileName`, `fallback` from servedBy.
  Widen `genPhase`'s return to forward `promptTokens`/`warm` from the
  engine result (it currently drops them); thrown generates record
  `status:"failed"` same as T006.
- [X] T008 `src/bun/rpc/handlers.ts`: `metrics.list`/`metrics.clear`
  handlers; `settings.get` includes `outputPanel`; `settings.set`
  accepts + persists `outputPanel`.
- [X] T009 `tests/rpc/metrics.test.ts`: entry per `chat.send` when on,
  zero entries when off, fusion → 2 entries (planner/executor keys),
  fallback files under serving model, clear, `outputPanel` persisted in
  settings round-trip, preview truncation.

## Phase 3 — panel UI (US1+US2)

- [X] T010 `src/renderer/src/lib/rpc.ts`: `metrics.entry` dispatch arm.
- [X] T011 `src/renderer/src/features/metrics/OutputPanel.tsx` NEW:
  bottom dock (~240px, `border-t`, `overflow-y-auto`); model-file tabs;
  groups per `roleKey` → persona subdivision; row = preview + sent/recv
  tokens + ms + warm/fallback badges; Clear button → `metrics.clear`.
- [X] T012 `src/renderer/src/features/chat/ChatPage.tsx`: mount
  `OutputPanel` below the composer inside the flex column; header switch
  → `settings.set({outputPanel})` + local state; hydrate via
  `metrics.list` on open; append on `metrics.entry`.
- [X] T013 `tests/rpc/metrics.test.ts`: `settings.set`/`get` toggle
  round-trip drives collection on/off.

## Phase 4 — polish

- [X] T014 `specs/016-output-stats-panel/validation.md` mapping
  FR-001..009 + SC to tests/code.
- [X] T015 Gates: `bun run test`, `tsc --noEmit`, `oxlint`,
  `hutch run build`; AGENTS.md section.

## Dependencies & notes

- T005 before T006/T007 (result field). US2 toggle = T008+T012.
- MVP: T001–T012 minus T013 — panel ships alone.
- Parallel: T004 ∥ T005; T011 ∥ T012 (T012 mounts after T011 exists).
- Format: `- [ ] T### [P?] [USn?] description + file path`.
