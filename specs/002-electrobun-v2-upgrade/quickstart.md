# Quickstart: Electrobun v2 Upgrade — Validation Guide

## Prerequisites

- Bun ≥ 1.4, network access (first `hutch` run downloads paired toolchain
  into `~/.hutch`), C toolchain + CMake (native build unchanged).

## Migration steps (what implement does)

```bash
bun add -d electrobun@^2           # 2.0.x
rm -f types/electrobun.d.ts        # shim replaced by .hutch/devkit types (keep if strict tsc still fails)
# create hutch.config.ts, rewrite electrobun.config.ts per contracts/config.md
# update src imports: "electrobun" → "electrobun/main"
hutch install --frozen-lockfile    # or bun install
hutch electrobun dev               # first run prepares .hutch/devkit
```

## Validation scenarios

### VS-1 — Dev mode (spec US1, SC-001)

1. `hutch dev` → app window opens with renderer UI, no console errors, ≤15s.
2. Edit a file under `src/renderer/src/` → UI hot-reloads (Vite dev-server).
3. Confirm `.hutch/devkit` exists and `bun run typecheck` resolves
   `electrobun` types without the hand-written shim.

### VS-2 — Packaged build (spec US2, SC-003)

1. `hutch build` (canary) → artifact in `artifacts/`.
2. Inspect bundle: `Resources/app/native/<platform>/` contains
   `libllama_shim.*` + `llama`/`ggml` deps; `Resources/app/views/main/` has
   the Vite output.
3. Launch the packaged app → same UI as dev.

### VS-3 — No stale tooling (spec US3, SC-004)

- `ls` root: exactly `electrobun.config.ts` + `hutch.config.ts` for the
  shell; no v1-era config remnants, no references to removed fields
  (validator would name them).

### VS-4 — Gates (SC-005)

- `bun run typecheck` → 0 errors
- `bun run lint` → clean
- `bun run build:renderer` → `dist/renderer` emitted
- `bun test` → existing tests pass unchanged (FFI behavior identical)
