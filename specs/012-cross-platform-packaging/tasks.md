# Tasks: Cross-Platform Packaging Validation

**Input**: Design documents from `/specs/012-cross-platform-packaging/`
**Scope**: complete per-OS configuration; **Linux enabled/verified only** —
macOS/Windows lanes ship configured but inactive (user directive).

## Phase 1: Setup

- [x] T001 [P] Fill `electrobun.config.ts` `build.{mac,win,linux}` sections: mac `codesign:false`,`notarize:false`,`createDmg:true`,`defaultRenderer:"native"`; win `autoGrantPermissions:[]`,`defaultRenderer:"native"`; linux `defaultRenderer:"native"` — research R2
- [x] T002 [P] Add prereq fail-fast to `scripts/build-native.sh` (name missing `cmake`/`c++`/`bun` before invoking — FR-004)
- [x] T003 [P] Mirror the prereq check in `scripts/build-native.ps1` (win-x64 lane)
- [x] T013 [P] Automatic semver version: create `scripts/version.ts` — derives `X.Y.Z` from `git describe --tags --abbrev=0` (fallback `package.json` version), appends `-canary.N` (N = commits since tag) for canary env, exact tag for stable; wire `electrobun.config.ts` `app.version` to `computeVersion()` instead of the hardcoded `"0.1.0"`

## Phase 2: Foundational

- [x] T004 Create `scripts/verify-artifact.sh <artifact-dir>`: asserts app binary exists+executable, required per-OS lib set under `native/` (`libllama_shim`,`libllama*`,`libggml*` with .so/.dylib/.dll patterns), `views/main/index.html` present — research R6

## Phase 3: User Story 1 — Repeatable per-OS build + smoke check (P1) 🎯 MVP

**Goal**: documented build produces a verified Linux artifact; mac/win paths documented-identical

**Independent Test**: `bun run build` → `verify-artifact.sh` PASS → manual smoke checklist green

- [x] T005 [US1] Run the full Linux packaging flow (`bun install` → `scripts/build-native.sh` → `bun run build:renderer` → `bun run build` → `verify-artifact.sh` on `build/canary-linux-*/`) and fix any staging gaps found
- [x] T014 [US1] Fix `libllama_shim` RUNPATH in `src/native/shim/CMakeLists.txt`: bake `$ORIGIN` (Linux) / `@loader_path` (macOS) instead of the absolute build-tree path, so packaged deps resolve next to the shim (FR-008); verify via `ldd` on the staged shim + relaunching the packaged app
- [x] T006 [US1] Walk the manual smoke checklist on the produced artifact (launch → model load → chat → stream → clean exit); record pass/fail
- [x] T007 [P] [US1] Write `docs/packaging.md` from `contracts/packaging.md`: per-OS build steps, smoke checklist, arch policy — mac/win sections marked "configured, not verified"

## Phase 4: User Story 2 — CI packaging matrix (P2)

**Goal**: `packaging.yml` with the Linux lane running and mac/win lanes gated off

**Independent Test**: workflow parses; linux job would produce+upload `canary-linux-x64`; `macos`/`windows` entries exist with `enabled: false`

- [x] T008 [US2] Create `.github/workflows/packaging.yml`: `on: push/PR`, matrix `include:` `{os,platform,enabled}` — `ubuntu-latest`/`linux-x64`/`enabled:true`, `macos-latest`/`darwin-arm64`/`enabled:false`, `windows-latest`/`win-x64`/`enabled:false`; job `if: matrix.enabled`
- [x] T009 [US2] Lane steps: checkout → setup-bun → cmake → `build-native` (sh/ps1 per OS) → `build:renderer` → `electrobun build --env=canary` → `verify-artifact.sh` → `upload-artifact` named `ai-desktop-app-canary-<os>-<arch>`; validate workflow syntax

## Phase 5: User Story 3 — Signing & distribution notes (P3)

**Goal**: signing/notarization guidance + unsigned-dev caveats documented

**Independent Test**: docs/packaging.md signing section covers mac codesign/notarize + Windows signtool + unsigned workarounds

- [x] T010 [US3] Write the signing section of `docs/packaging.md`: macOS `codesign`/`notarize` enable path + entitlements + Gatekeeper caveat; Windows post-build `signtool` + SmartScreen caveat; secrets-never-committed note — FR-006

## Phase 6: Polish

- [x] T011 [P] Add `package`/`package-stable` recipes to `justfile` (native → renderer → electrobun build → verify) + update `AGENTS.md` commands/packaging notes
- [x] T012 Live-validate `quickstart.md` S1–S4; record results in `specs/012-cross-platform-packaging/validation.md`

## Dependencies & Execution Order

- Phase 1–2 are independent of each other; T004 blocks nothing but T005 uses it.
- US1 (T005–T007) is the MVP — verifiable end-to-end on this host.
- US2 (T008–T009) needs the workflow file only; its linux steps mirror T005.
- US3 (T010) is docs-only; parallel to anything after T007 starts.

## Parallel Opportunities

- T001/T002/T003 [P] — different files.
- T007 and T010 [P-ish] — same `docs/packaging.md`; write sections in one pass sequentially despite both being docs.

## Implementation Strategy

MVP = Phase 1 + T004 + T005 (a verified Linux artifact). Everything else layers on: docs (US1/US3), CI (US2), recipes (polish).

## Phase 7: Convergence

- [ ] T015 Drive a full smoke-checklist pass inside the packaged canary artifact — launch → model load → send message → token streaming → clean exit — per US1/AC3 / SC-002 (partial)
- [x] T016 Verify clean-checkout reproducibility: `git clean`-style fresh tree (or `git worktree add`) → `just package` produces a verified artifact per FR-009 (partial)
