# Validation — 016-output-stats-panel

## Requirement → test mapping

| Req | Verified by |
|---|---|
| FR-001 entry per call + <=120-char preview | `metrics rpc > toggle off records nothing; toggle on records one entry` (preview bound asserted) |
| FR-002 actual token counts | engine returns `promptTokens` via `lls_token_count` on the built prompt; fake-engine path asserts `promptTokens: 7` flows through |
| FR-003 fusion per-phase entries | `metrics rpc > fusion emits one entry per phase with correct roles` — `[planner, executor]` |
| FR-004 tag/persona/fallback capture | fields populated in `recordCall` (handlers) + `runPhase` (fusion); `servedBy === "fallback"` ⇒ `fallback: true` |
| FR-005 switch + persist + bottom dock | `settings.get/set roundtrips outputPanel` + `OutputPanel` is a `flex-col` sibling under `Composer` (pushes up, never overlays) |
| FR-006 tabs per model + role/persona groups | `OutputPanel` model tabs + role→persona grouped render |
| FR-007 bounded ~500 ring | `MetricsStore > ring cap: >500 drops oldest, keeps chronological order` |
| FR-008 clear via typed RPC | `metrics.entry event fires live; list/clear roundtrip` |
| FR-009 main-process only | collection lives in `handlers.ts`/`fusion.ts`; renderer receives `metrics.list` + `metrics.entry` only |

## Success criteria

| SC | Result |
|---|---|
| SC-001 exact token values | `promptTokens` = real tokenizer over the sent prompt; `outputTokens` = decode count |
| SC-002 live updates | `metrics.entry` event asserted in test |
| SC-003 toggle/clear behavior | covered above |
| SC-004 render 500 entries | sanity note: rows are flat `<div>`s inside `ScrollArea`; 500 rows render as a plain list — no virtualization needed at this scale; grouping is a single `useMemo` pass over ≤500 items, O(n) |
| SC-005 attribution (fusion/fallback) | planner/executor roleKey + `fallback` flag asserted |

## Gates

- `bun run test`: 236 pass / 0 fail
- `bunx tsc --noEmit`: clean
- `bunx oxlint src/bun src/renderer src/shared`: 5 pre-existing warnings only (no new)
- `hutch run build`: green — `build/canary-linux-x64`
