---
description: "Task list for feature implementation"
---

# Tasks: Scripts Workspace & External Script Files

**Input**: Design documents from `/specs/027-scripts-workspace-external-files/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Organization**: Tasks grouped by user story — US1 (workspace, P1), US2
(import, P1), US3 (linked-file safety, P2). Tests are included: every gate
(SC-008) plus the plan's focused-test list requires them.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

## Path Conventions

- Bun main process: `src/bun/`
- Shared RPC/domain types: `src/shared/`
- Renderer: `src/renderer/src/`
- Tests: `tests/` (`tests/rpc/`, `tests/scripts/`, `tests/renderer/`)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No project scaffolding needed — the feature extends the
existing Electrobun + React codebase with zero new dependencies.

- [x] T001 [P] Extend shared types in `src/shared/types.ts`:
  `ScriptEntry` gains `approvedFingerprint?: string`;
  `ScriptListItem` gains `linked: boolean` and `sourceState: "ok" | "missing"`;
  add `ScriptImportError = "unsupported-ext" | "unreadable" | "invalid-encoding" | "too-large"`,
  `ScriptImportCandidate`, `ScriptImportParams`, `ScriptImportResult`
  (shapes per data-model.md); `ScriptDecision` gains
  `"approveChangedSession"`; `ToolCallRecord` gains `contentChanged?: boolean`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Store/service primitives every story needs — source-state
lookup, fingerprint helper, runtime badge data. No consent-flow change yet
(that is US3); no UI yet.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 Add fingerprint + path utilities in
  `src/bun/scripts/store.ts`: `fingerprint(bytes: string): string` (sha256
  hex), `normalizeSourcePath(p: string): string | null` (tilde expand,
  absolute check, `realpathSync` best-effort, reject relative/non-file)
- [x] T003 In `src/bun/scripts/service.ts` `list()`: populate the new
  `linked` (`source.kind === "external"`) and `sourceState` (external +
  `readSource`-style probe ⇒ `"missing"`) fields on each `ScriptListItem`;
  keep one stat-style probe per external entry (R7)

**Checkpoint**: Foundation ready — user story implementation can begin

---

## Phase 3: User Story 1 — Scripts have their own space, grouped by language (Priority: P1) 🎯 MVP

**Goal**: Dedicated top-level Scripts sidebar area with collapsible
Python/R groups (counts, alphabetical, missing-runtime badges), opening
any script directly into run form + code + params (ScriptDetail) — the
list page is gone. Reachable collapsed, via palette, breadcrumb shows
Scripts › language › id.

**Independent Test**: Seed two Python + one R script → sidebar shows
`Python (2)` / `R (1)` groups; click a script → run form, code and params
open directly (SC-001, ≤2 clicks). With R runtime absent → R group +
rows carry "runtime missing" reason while staying editable. Empty state
offers New script / Import from file.

### Tests for User Story 1

- [x] T004 [P] [US1] Unit tests for grouping helpers in
  `tests/renderer/scripts-groups.test.ts`: per-language grouping,
  case-insensitive alphabetical sort, counts, only non-empty groups,
  disabled rows flagged, runtime-missing flagged per group

### Implementation for User Story 1

- [x] T005 [US1] Create `src/renderer/src/features/scripts/scripts-groups.ts`:
  pure `groupScripts(items): {runtime, label, count, missing, rows}[]`
  implementing FR-002/FR-003/FR-006 sort/group/filter rules
- [x] T006 [US1] Create `src/renderer/src/features/scripts/ScriptDetail.tsx`:
  surface body for `surface:scripts` — states empty (New/Import CTAs) /
  create / view one script with `RunForm` + params + `ScriptEditor`
  (in-place edit of metadata, FR-004; code pane **read-only for linked
  scripts** per FR-023); header: id (title-truncated), language badge,
  `external` badge + path when `linked`
- [x] T007 [US1] Update `src/renderer/src/features/chat/AppSidebar.tsx`:
  add top-level `Scripts` NavGroup (Chats · Extensions · Scripts ·
  Configurations order); render language sub-groups via `groupScripts`
  with counts, collapsible, `runtime missing` badge + reason tooltip,
  dimmed disabled rows, Link-icon suffix on linked rows; group footer:
  `New script`, `Import from file…`, `Runtime paths…` (→ surface:settings);
  REMOVE the `Scripts` item from Configurations (FR-001, FR-005); row
  click selects `surface:scripts` + sets `selectedScriptId`; icon-rail
  collapsed state keeps access (edge case)
- [x] T008 [US1] Wire selection state: `surface:scripts` renders
  `ScriptDetail` for `selectedScriptId` (ChatPage/WorkspacePanel wiring);
  delete `ScriptsPage.tsx` (FR-004) and repoint its callers
- [x] T009 [US1] Update `src/renderer/src/features/workspace/breadcrumb.ts`:
  `Scripts` crumb when no selection; `Scripts › Python|R › <id>` when a
  script is selected (FR-007)
- [x] T010 [US1] Update `src/renderer/src/features/command/CommandPalette.tsx`:
  `Scripts` group listing every script (client-filtered) → opens detail;
  actions `New script`, `Import script from file`, `Script runtime
  settings` (FR-007)

**Checkpoint**: US1 fully functional and testable independently

---

## Phase 4: User Story 2 — Import scripts from files on disk (Priority: P1)

**Goal**: Native multi-select picker for `.py`/`.r`/`.R` files → preview
dialog (language, editable suggested id, per-file errors) → Link (default)
or Copy per batch → per-file results; duplicates reported, not created;
partial failure never aborts; Advanced typed-path field preserved.

**Independent Test**: Import picks 3 files (2 `.py`, 1 `.R`) with default
Link → three runnable scripts in the right groups, no code typed; a
broken file in the batch fails with reason while the rest import; picking
an already-linked file reports the existing script (SC-002, SC-003).

### Tests for User Story 2

- [x] T011 [P] [US2] RPC tests in `tests/rpc/scripts.test.ts` (new cases):
  `script.pickImport` candidate validation per error code
  (`unsupported-ext`, `unreadable`, `invalid-encoding`, `too-large` >2 MiB);
  `suggestedId` slug + `-2` dedup; `duplicateOf` detection;
  `script.import` batch partial-failure + per-file statuses; >10 files ⇒
  `INVALID_PARAMS`; copy mode writes stored source; link mode records
  `approvedFingerprint`
- [x] T012 [P] [US2] Service tests in `tests/scripts/` for import/relink
  validation helpers (UTF-8/binary detection, size cap, path normalize)

### Implementation for User Story 2

- [x] T013 [US2] `src/bun/scripts/service.ts`: add `importCandidates(paths)`,
  `importFiles(params)`, `relink(id, newPath)` — validation per
  contracts/rpc.md, runtime from extension (`.py`→python, `.r`/`.R`→r,
  case-insensitive), slug + `-2`/`-3` dedup, `duplicateOf` on resolved
  path, link ⇒ `source:{kind:"external", path:normalized}` +
  `approvedFingerprint` = sha256(bytes); copy ⇒ stored source via
  `writeSource`; relink keeps id/params/timeout/enabled, refreshes
  fingerprint (FR-017)
- [x] T014 [US2] `src/bun/rpc/handlers.ts`: `script.pickImport`
  (`dialogs.pickFiles` ext filter `py,PY,r,R`, cancelled ⇒ empty),
  `script.import`, `script.relink` (`INVALID_PARAMS` when entry not
  external; picker ext must match `entry.runtime`; cancel ⇒ `{entry:null}`)
- [x] T015 [US2] Create `src/renderer/src/features/scripts/ImportScriptsDialog.tsx`:
  pickImport preview — per-row language badge, editable suggested-id
  input, error rows with reason excluded from confirm; `Link (default) |
  Copy` mode toggle (FR-010); post-import per-file status
  imported/duplicate/failed (FR-013/FR-014); wire into
  `use-scripts.ts` (pickImport/import/relink) and the sidebar/detail
  Import actions from T007/T006
- [x] T016 [US2] `src/renderer/src/features/scripts/ScriptEditor.tsx`: keep
  the typed absolute-path field for `external` sources under an
  **Advanced** collapsible section (FR-020); upsert with external path
  resets `approvedFingerprint` (server side, service.ts)

**Checkpoint**: US2 independently functional

---

## Phase 5: User Story 3 — Linked files stay safe and recoverable (Priority: P2)

**Goal**: Linked scripts show external badge/path everywhere; a
`source missing` state + Relink replaces confusing failures; model- and
pipeline-initiated runs re-request consent when content changed since
last approval — even under allow-session — offering "Approve changes to
this script for this session"; manual runs unchanged; audit records
linked/stored origin.

**Independent Test**: Approve a model-invoked linked script, edit the
file, trigger again → re-prompted with "content changed" wording even
under session allow (SC-004); move the file → sidebar/detail show
`source missing` + Relink and model invocation is refused with a clear
reason (SC-005); Relink preserves id/settings.

### Tests for User Story 3

- [x] T017 [P] [US3] Service/consent tests in `tests/scripts/` (or extend
  existing): `consentState` returns `source-missing`/`ask-changed`/`ask`/`auto`
  correctly; `ask-changed` overrides session grant; `approveChangedSession`
  grants only that script for the `ns` and persists `approvedFingerprint`;
  manual `call` refreshes fingerprint; audit JSON gains
  `origin: "linked"|"stored"`
- [x] T018 [P] [US3] RPC/loop tests: model `run_script` of a changed linked
  script emits pending `tool.update` with `contentChanged: true` even with
  session grant; missing source refuses `source-missing`; pipeline
  (fabric) path mirrors both (SC-004, FR-016)
- [x] T019 [P] [US3] Renderer test: ToolCallCard consent variant renders
  changed-file wording + three buttons mapping to
  `approve`/`approveChangedSession`/`deny`

### Implementation for User Story 3

- [x] T020 [US3] `src/bun/scripts/service.ts`: `consentState(entry, ns)`
  returning `"auto" | "ask" | "ask-changed" | "source-missing"` (R3);
  `changedGrants: Map<ns, Set<id>>`; `respond()` handles
  `approveChangedSession` (grant + persist fingerprint); `autoApprove`
  unchanged; successful manual `call` refreshes `approvedFingerprint`;
  `recordAudit` gains `origin` from `entry.source.kind` (FR-022)
- [x] T021 [US3] `src/bun/tools/loop.ts` `runScriptVerdict`: switch to
  `consentState` — `source-missing` ⇒ refuse `source-missing`;
  `ask-changed` ⇒ prompt regardless of `autoApprove`, set
  `call.contentChanged = true`; approval of a changed prompt persists
  fingerprint (FR-016, FR-018)
- [x] T022 [US3] `src/bun/fabric/runtime.ts`: same `consentState` switch
  for `pipeline` initiator — identical semantics, `source-missing` →
  `FabricError` with clear code (keeps step-failure contract)
- [x] T023 [US3] `src/bun/rpc/handlers.ts`: `tool.respond` accepts
  `"approveChangedSession"` and forwards it; `script.run` fails
  `SCRIPT_SOURCE_MISSING` when a linked entry's source is unreadable
  (FR-016)
- [x] T024 [US3] `src/renderer/src/features/scripts/ScriptDetail.tsx` +
  sidebar rows: `source missing` warning badge + `Relink…` button wired
  to `script.relink`; `external` badge + path (title, middle-truncated)
  on all linked surfaces (FR-015, FR-016, FR-017)
- [x] T025 [US3] `src/renderer/src/features/chat/ToolCallCard.tsx` (and the
  fabric pending-call surface if separate): `contentChanged` variant —
  warning icon, "changed on disk since you last approved it" copy,
  buttons `Approve once` / `Approve changes to this script for this
  session` / `Deny` → `tool.respond` decisions (FR-018 wording verbatim)

**Checkpoint**: All user stories independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Gates, docs, regression sweep.

- [x] T026 [P] Large-list check: seed/render 200 scripts, confirm grouped
  sidebar scrolls and open time is unchanged (SC-007) — record in
  validation notes
- [x] T027 Migration check: pre-feature `scripts.json` with stored +
  external entries loads, groups correctly, external rows show linked
  badge (FR-021, SC-006)
- [x] T028 Update `AGENTS.md` with feature 027 module-map additions
  (import flow, consentState, Scripts NavGroup, ScriptDetail)
- [x] T029 Run all gates: `bun run typecheck`, `bun run lint`,
  `bun test ./tests`, `bun run build:renderer` (SC-008)
- [ ] T030 Walkthrough `quickstart.md` end-to-end; record results

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on T001 — BLOCKS all stories
- **US1 (Phase 3)**: needs T001–T003 (`linked`/`sourceState` badges use T003 data)
- **US2 (Phase 4)**: needs T001–T002; UI tasks need US1's surface/actions (T006/T007)
- **US3 (Phase 5)**: needs T001–T003 + US2's link-import fingerprint baseline (T013)
- **Polish (Phase 6)**: after all stories

### User Story Dependencies

- **US1 (P1)**: independently testable once foundational done
- **US2 (P1)**: logic is independent; UI mount points come from US1
- **US3 (P2)**: depends on linked scripts existing (US2) — the fingerprint
  write points at import/relink are the consent baseline

### Parallel Opportunities

- T004 (groups test) ∥ T005/T006
- T011 ∥ T012 ∥ T013 (service logic before its tests finalize is fine —
  write tests first where practical)
- T017 ∥ T018 ∥ T019
- T026 ∥ T027

## Parallel Example: User Story 3

```bash
Task: "T017 consentState/changedGrants/audit tests"
Task: "T019 ToolCallCard consent-variant renderer test"
# then implementation T020–T025, loop + fabric switched together
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001–T003 foundation
2. T004–T010 US1 — scripts live in their own workspace
3. STOP and validate: sidebar groups, detail opens, palette, breadcrumb

### Incremental Delivery

1. Foundation → US1 (MVP: workspace)
2. + US2 → imports land in the groups US1 built
3. + US3 → safety layer completes the linked-file lifecycle
4. Polish → gates green

---

## Notes

- [P] tasks = different files, no dependencies
- [US#] label maps task to spec user story for traceability
- Commit after each task or small group via
  `.specify/extensions/git/scripts/bash/auto-commit.sh`
- Manual validation (real file picker, real scripts) is owner-side like
  feature 026 — headless tests cover the logic
- 028 boundary: fingerprints here are consent-time only; the native host
  re-fingerprints at exec time (out of scope)
