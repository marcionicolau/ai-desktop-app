# Research: Electrobun v2 Upgrade

Phase 0 output — resolves all technical unknowns for the v1→v2 migration.

## Decision 1: Target version & package layout

- **Decision**: `bun add -d electrobun@^2` (2.0.6 at migration time). The npm
  package stays the front door; on first run it downloads and verifies its
  paired Hutch release into `~/.hutch` and projects the SDK into
  `.hutch/devkit/` in the project.
- **Rationale**: v2's documented install path — no global Hutch install,
  no postinstall; the lockfile tracks the paired toolchain set.
- **Alternatives considered**: pin a global `hutch` CLI — rejected, adds a
  machine-level prerequisite the docs explicitly remove.

## Decision 2: Config split per v2 schema

- **Decision**: Two files, as v2 prescribes:
  - `electrobun.config.ts` — `app` + `build` + `runtime` + release/distribution.
    `build.mainProcess: "bun"` set **explicitly** (default since 2.0.4, but
    explicit avoids silent runtime changes and the migration error for
    ambiguous configs).
  - `hutch.config.ts` — `scripts` map (`install`, `dev`, `build`,
    `build:stable`), plus `electrobun: { version: "2.0.6" }` exact pin (the
    shipped-template convention; `hutch electrobun update` bumps it later).
- **Rationale**: v2 validates and rejects removed v1 fields by name;
  `hutch.config.ts` is the only place Hutch reads scripts from. This also
  retroactively corrects the Phase-1 T004 deviation (hutch.config.ts was
  skipped because it didn't exist in v1).
- **Alternatives considered**: keep `electrobun` bin scripts in package.json
  only — they still forward through Hutch, but the documented convention is
  `hutch` tasks; we adopt the documented layout (spec FR-006).

## Decision 3: Views & renderer bundling under v2

- **Decision**: Keep Vite as the renderer build (Tailwind v4/shadcn require
  plugin transforms Hutch's bundler can't run — unchanged from v1 analysis).
  `vite build` → `dist/renderer`, staged via `build.copy` to `views/main/`,
  loaded as `views://main/index.html`. If v2's `copy` proves file-only, emit
  the map from the dist listing instead of a directory entry.
- **Rationale**: v2 docs confirm framework templates run their own Vite build
  and copy output; `views://` semantics unchanged.
- **Alternatives considered**: `build.views` with Hutch's own bundler —
  rejected, same reason as v1 (no plugin pipeline).

## Decision 4: Main-process imports & runtime

- **Decision**: Migrate `import ... from "electrobun"` → `"electrobun/main"`
  (v2's runtime-neutral specifier), `electrobun/view` for the webview side.
  `build.mainProcess: "bun"` keeps `bun:ffi`, `Utils.paths`, and the whole
  feature-001 design valid — packaged apps run Bun 1.4.x.
- **Rationale**: `electrobun/main` is the documented import that works
  regardless of selected runtime; app code "usually needs little or no
  change" per the migration guide.
- **Alternatives considered**: Cottontail main process — rejected: it's
  experimental, and `bun:ffi` availability there is unverified; the
  constitution's FFI design assumes Bun.

## Decision 5: TypeScript typings — devkit sysroot replaces the shim

- **Decision**: Point `tsconfig`/editor types at `.hutch/devkit` (the SDK
  projection Hutch writes per prepared release) and delete the hand-written
  `types/electrobun.d.ts` shim + `paths` override added during v1 setup —
  unless typecheck shows the devkit types still break under strict mode, in
  which case the shim is kept and extended to the `electrobun/main` surface.
- **Rationale**: v2 docs instruct "point TypeScript at the devkit so editors
  resolve" — the devkit ships release-matched config/SDK types, which is the
  best-practice answer to the v1 type-error problem.
- **Alternatives considered**: keep the shim — only as fallback (see above);
  a maintained devkit beats a hand-maintained ambient file.

## Decision 6: Native library staging under v2

- **Decision**: Stage per-OS artifacts via `build.copy` into the app
  resources root: `"native/out/<platform>"` → `"native/<platform>"`,
  producing `Resources/app/native/<platform>/{libllama_shim,libllama,ggml…}.*`
  at runtime — same logical layout as v1, verified against the new
  resources path API (dev: `native/out/<platform>`). Keep `useAsar: false`
  equivalent (verify the v2 field name — `build.useAsar` existed in v1) so
  `dlopen` sees real files, not archive entries.
- **Rationale**: `dlopen` needs real filesystem paths inside the bundle;
  `Resources/app/` is the documented packaged location.
- **Alternatives considered**: embedding libs into the ASAR — rejected,
  `dlopen` can't open archive members.

## Decision 7: bun:ffi / llama.cpp / memory model — unchanged

- **Decision**: No changes to the FFI contract, shim symbols, or the
  pull-based `lls_step` design from feature 001. Bun 1.4.x in packaged apps
  preserves `dlopen`/`FFIType` semantics; the JSCallback-threading finding
  and ownership rules carry over verbatim.
- **Rationale**: the v2 change is build orchestration + config schema, not
  the JS runtime or FFI subsystem. llama.cpp stays the pinned `b12285`
  submodule; CMake flags unchanged.
- **Alternatives considered**: re-evaluate `bun:ffi` stability claims under
  the packaged Bun — deferred to implementation-time verification
  (`lifecycle.test.ts` runs against the packaged runtime, not just dev Bun).

## Decision 8: Toolchain housekeeping

- **Decision**: During the migration: re-resolve `bun.lock`, keep Bun for
  install/test/typecheck (constitution), keep `oxlint`+`vite` at current
  majors, add `.hutch/` and `~/.hutch` cache notes to `.gitignore` (project
  `.hutch/devkit` ignored; it's generated).
- **Rationale**: devkit/sysroot is generated state — not committed.
- **Alternatives considered**: committing devkit for offline builds —
  rejected, Hutch re-projects it and docs treat it as generated.
