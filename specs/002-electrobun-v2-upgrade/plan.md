# Implementation Plan: Electrobun v2 Upgrade

**Branch**: `002-electrobun-v2-upgrade` | **Date**: 2026-11-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-electrobun-v2-upgrade/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Migrate the project shell from Electrobun 1.18 to 2.x: split config into
`electrobun.config.ts` (app/build, `mainProcess: "bun"`) +
`hutch.config.ts` (scripts + release pin), move main-process imports to
`electrobun/main`, replace the hand-written type shim with the
`.hutch/devkit` SDK projection, and restage Vite output + per-OS native libs
through v2's `build.copy`. The FFI/llama.cpp/memory design is unchanged —
v2 alters build orchestration, not the Bun runtime or `bun:ffi`.

## Technical Context

**Language/Version**: TypeScript (strict) on Bun ≥ 1.4; C11 shim + vendored
llama.cpp `b12285` unchanged.

**Primary Dependencies**: electrobun@^2 (+ paired Hutch toolchain),
Vite + React + Tailwind v4 + shadcn/ui, `bun:ffi` + llama.cpp.

**Storage**: unchanged (JSON in `Utils.paths.userData`).

**Testing**: `bun test` — migration validated by existing test suite +
quickstart VS-1…VS-4; FFI lifecycle test doubles as packaged-runtime FFI
verification.

**Target Platform**: unchanged — Windows/macOS/Linux per Electrobun host matrix.

**Project Type**: desktop-app tooling migration.

**Performance Goals**: dev command → window < 15s; renderer build unchanged.

**Constraints**: exactly one shell config pair; no stale v1 fields (validator
rejects by name); `dlopen` requires real files in bundle (no ASAR);
`bun:ffi` semantics must hold under the packaged Bun 1.4.x runtime.

**Scale/Scope**: ~6 files touched (package.json, electrobun.config.ts,
hutch.config.ts, tsconfig.json, types shim removal, src/bun imports) +
.gitignore + scripts tweaks.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Evidence |
|-----------|---------|----------|
| I. Local-First Inference | PASS | FFI/shim design untouched (research.md D7); packaged runtime remains Bun |
| II. Electrobun Boundaries | PASS | `electrobun/main` import + typed RPC contract preserved |
| III. Strict TS & Typed FFI | PASS | devkit types or shim fallback keeps strict `tsc` green (D5) |
| IV. shadcn + Tailwind v4 | PASS | Vite renderer retained; Hutch bundler still bypassed for views (D3) |
| V. Vite Build Pipeline | PASS | `vite build` + HMR preserved via dev script composition (D3, contracts/config.md) |
| VI. Minimal Dependencies | PASS | same package (`electrobun`), no new runtime deps; `.hutch` is toolchain cache, not a dependency |

**Pre-Phase-0 gate**: PASS. **Post-Phase-1 re-check**: PASS — migration adds
no dependencies, removes one maintenance artifact (the shim) where possible.

## Project Structure

### Documentation (this feature)

```text
specs/002-electrobun-v2-upgrade/
├── plan.md              # This file
├── research.md          # Phase 0 output (8 decisions)
├── quickstart.md        # Phase 1 output (migration + VS-1…VS-4)
├── contracts/
│   └── config.md        # hutch.config.ts / electrobun.config.ts contract
└── checklists/
    └── requirements.md  # /speckit-specify
```

`data-model.md` omitted — tooling migration introduces no data entities.

### Source Code (repository root) — touched files

```text
package.json          # electrobun@^2; scripts delegate to hutch
electrobun.config.ts  # rewritten: mainProcess:"bun", bun/views/copy/runtime
hutch.config.ts       # NEW: scripts map + electrobun version pin
tsconfig.json         # drop "electrobun" paths override (if shim removed)
types/                # DELETE types/electrobun.d.ts if devkit types suffice
src/bun/index.ts      # imports → "electrobun/main"
src/renderer/         # unchanged (Vite/Tailwind/shadcn as-is)
scripts/              # build-native.{sh,ps1}, stage-native.ts unchanged
.gitignore            # + .hutch/
.hutch/dependencies.lock  # NEW (toolchain pin — committed; devkit/ + locks/ ignored)
```

**Structure Decision**: No source-layout changes — v2 conventions already
match our `src/bun` + separate-renderer layout. Only config and import
specifiers migrate.

## Complexity Tracking

No constitution violations — section not applicable.
