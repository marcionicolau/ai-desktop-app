---
description: "Task list for Electrobun v2 Upgrade implementation"
---

# Tasks: Electrobun v2 Upgrade

**Input**: Design documents from `/specs/002-electrobun-v2-upgrade/`

**Prerequisites**: plan.md, spec.md, research.md, contracts/config.md, quickstart.md

**Tests**: Validation is via quickstart.md scenarios VS-1…VS-4 and existing
`bun test` suite — no new test files for a tooling migration.

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story label (US1, US2, US3) — story phases only

---

## Phase 1: Setup (Baseline & Dependency Bump)

**Purpose**: Capture a working baseline and bump the shell dependency

- [x] T001 Record baseline in `specs/002-electrobun-v2-upgrade/baseline.md`: output of `bun run typecheck`, `bun run lint`, `bun run build:renderer`, and `bun test` — all must pass before migrating (regression reference for SC-002)
- [x] T002 Bump shell dependency with `bun add -d electrobun@^2` in `package.json` and confirm installed version is 2.0.x

---

## Phase 2: Foundational (Config Migration)

**Purpose**: v2 config split — blocks all user stories

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Create `hutch.config.ts` at repo root per `contracts/config.md`: `electrobun.version` pin set to the exact version bun resolved — read `node_modules/electrobun/package.json` `version` field, not a hardcoded value and `scripts` map (`install`, `build:renderer`, `dev`, `build`, `build:stable`)
- [x] T004 Rewrite `electrobun.config.ts` per `contracts/config.md`: `build.mainProcess: "bun"` explicit, `build.bun.entrypoint = "src/bun/index.ts"`, `build.copy` mapping `dist/renderer` → `views/main` and `native/out` → `native`, `runtime.exitOnLastWindowClosed: true`; remove v1-only fields if the validator names them
- [x] T005 Update `package.json` scripts: `dev`/`build*` delegate to `hutch` tasks; keep `typecheck`, `lint`, `test`, `build:renderer` as Bun/npm-level commands
- [x] T006 [P] Update `.gitignore`: add `.hutch/` (generated devkit); ensure `hutch.lock` is NOT ignored (it is committed)
- [x] T007 Update main-process import in `src/bun/index.ts`: `from "electrobun"` → `from "electrobun/main"` (webview code uses `electrobun/view` when added later)
- [x] T008 Run first prepare — `bun x electrobun dev` (npm bin forwards through Hutch; guaranteed path): let Hutch download the paired toolchain into `~/.hutch` and project `.hutch/devkit/`; confirm `.hutch/devkit` exists
- [x] T009 Remove `types/electrobun.d.ts` and the `"electrobun"` `paths` override in `tsconfig.json`, pointing types at `.hutch/devkit` (e.g., `typeRoots` or the documented devkit typing mechanism); run `bun run typecheck` — if devkit types still fail under strict mode, restore the shim extended to the `electrobun/main` surface instead (research.md D5)

**Checkpoint**: `bun run typecheck` + `bun run lint` + `bun run build:renderer` all green under v2 — story work can begin

---

## Phase 3: User Story 1 - App Runs on the New Shell (Priority: P1) 🎯 MVP

**Goal**: Dev mode launches the app window with the renderer live-reloading, exactly as under v1.

**Independent Test**: `hutch dev` → window opens ≤15s with renderer UI; edit a file in `src/renderer/src/` → hot reload (quickstart VS-1).

### Implementation for User Story 1

- [x] T010 [US1] Implement minimal window bootstrap in `src/bun/index.ts`: `new BrowserWindow({ title, url })` loading `views://main/index.html` for packaged runs and the Vite dev-server URL (`http://localhost:5173`) in dev — required for any dev/packaged launch to show the UI (also covers feature-001 T017 bootstrap)
- [x] T011 [US1] Wire dev flow so `dev` starts the Vite dev-server alongside `electrobun dev` (per `hutch.config.ts` `dev` script composition in contracts/config.md); verify `hutch pm exec` resolves `node_modules/.bin/vite` — fallback to `bunx vite` or `./node_modules/.bin/vite` in the script string if not; verify `vite build` output is not required in dev
- [x] T012 [US1] Verify `bun run build:renderer` then `hutch build --env=dev` produces a launchable app loading `views://main/index.html`; fix `build.copy` semantics if v2 requires per-file entries instead of directory copies (research.md D3)

**Checkpoint**: US1 validated — dev window + HMR work under Electrobun 2.x

---

## Phase 4: User Story 2 - Release Pipeline Produces Installers (Priority: P2)

**Goal**: Canary/release build yields an installable artifact with native libraries staged correctly.

**Independent Test**: `hutch build --env=canary` → artifact in `artifacts/`; inspect bundle for `Resources/app/views/main/` and `Resources/app/native/`; launch packaged app (quickstart VS-2).

### Implementation for User Story 2

- [x] T013 [US2] Run `hutch build --env=canary` (or `bun run build:canary`) to completion; fix any v2 field-name errors the validator reports in `electrobun.config.ts`
- [x] T014 [US2] Verify bundle layout: `Resources/app/views/main/` contains Vite output; `Resources/app/native/<platform>/` staging rule works — if `native/out/` is empty (feature-001 T011–T013 pending), create a placeholder `.so`/document the pending native build, and confirm the copy rule itself
- [x] T015 [US2] Verify ASAR/archiving config: confirm `useAsar` (or v2 equivalent) is off for native libs, or add the platform globs to the unpack list so `dlopen` sees real files (spec constraint, research.md D6)
- [x] T016 [US2] Launch the packaged artifact and confirm identical UI (SC-002, SC-003)

**Checkpoint**: US2 validated — installer artifact produced and launches

---

## Phase 5: User Story 3 - Single Documented Toolchain (Priority: P3)

**Goal**: Exactly one shell-config pair following v2 conventions; no stale v1 references anywhere.

**Independent Test**: Root contains only `electrobun.config.ts` + `hutch.config.ts`; every documented command works (quickstart VS-3).

### Implementation for User Story 3

- [ ] T017 [US3] Audit repo for v1 remnants: grep for removed v1 config fields, `electrobun` bin invocations outside `hutch` tasks, and references to deleted `types/electrobun.d.ts`; clean up findings
- [ ] T018 [US3] Verify every documented command end-to-end: `hutch install`, `hutch dev`, `hutch build`, `bun run typecheck`, `bun run lint`, `bun test`, `bun run build:renderer`

**Checkpoint**: US3 validated — one toolchain, all commands documented and working

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Full validation sweep

- [ ] T019 Run complete `quickstart.md` validation (VS-1 through VS-4) and record results
- [ ] T020 Update `specs/001-desktop-ai-chat/tasks.md` note or `AGENTS.md` with the v2 command set (`hutch` vs `electrobun` bin) so feature-001 tasks reference the right commands

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Setup; BLOCKS all stories (config must parse before anything runs)
- **US1 (Phase 3)**: Depends on Foundational
- **US2 (Phase 4)**: Depends on Foundational; can follow US1 (build on working dev config)
- **US3 (Phase 5)**: Depends on US1+US2 (audit needs final state)
- **Polish (Phase 6)**: Last

### User Story Dependencies

- **US1**: Foundational only — the MVP: dev works again
- **US2**: Foundational + ideally US1 (same `build.copy` semantics verified in dev path first)
- **US3**: after US1/US2 — auditing the final, working state

### Parallel Opportunities

- T006 (.gitignore) parallel with T003–T005 (different files)
- Within US2: T014/T015 inspection tasks are partially parallel with fix iterations

---

## Parallel Example: Foundational

```bash
# Config files can be authored in parallel (different files):
Task: "Create hutch.config.ts per contracts/config.md"
Task: "Rewrite electrobun.config.ts per contracts/config.md"
Task: "Update .gitignore with .hutch/"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 baseline → Phase 2 config migration → green typecheck/lint/renderer build
2. Phase 3 US1 → dev window + HMR = migration MVP

### Incremental Delivery

1. Setup + Foundational → v2 toolchain parses and prepares
2. + US1 → dev workflow restored
3. + US2 → packaging restored
4. + US3 + Polish → single documented toolchain, full validation
