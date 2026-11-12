# Validation: Startup Model Selection

## Gates (headless)

- `bun test ./tests` — **379 pass / 0 fail** (57 files); new
  `tests/renderer/startup-prompt.test.ts` covers the trigger predicate:
  pre-hydration suppression (U1), `unloaded`/`error` → open, `loading` →
  wait, `ready` → settle, latch/fire-once (FR-004), post-ready error (U2).
- `bun run typecheck` — clean. `bun run lint` — 0 errors.
- `bun run build:renderer` — green.

## Quickstart scenarios

| Scenario | Coverage |
|----------|----------|
| S1 fresh install → auto-open | predicate test + effect logic; **live verify needs `electrobun dev` window** |
| S2 configured model → no prompt | `ready` → settle (predicate test) + hydration gate |
| S3 empty library → download path | ModelLibrary download form renders unconditionally; `autoLoadOnDownload` loads the file post-download (T007) |
| S4 dismissal | fire-once latch + `startupPrompted` clear on close (T004) |
| S5 missing default file | bootstrap `error` → `error` triggers open (FR-007) |
| S6 loading guard | `loading` → wait (FR-006) |

## Caveats

- Live E2E (`bun run dev` window) not run in this environment; the trigger
  predicate is headless-tested and the effect is a thin latch over it.
- A mid-session manual unload (`modelStatus → unloaded`) after evaluation
  cannot re-trigger — the latch is already set (spec assumption).
