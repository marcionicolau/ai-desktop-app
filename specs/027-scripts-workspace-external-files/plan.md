# Implementation Plan: Scripts Workspace & External Script Files

**Branch**: `027-scripts-workspace-external-files` | **Date**: 2026-04-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/027-scripts-workspace-external-files/spec.md`

## Summary

Promote scripts to a first-class sidebar workspace (grouped by Python/R,
alphabetical, per-language missing-runtime badges) that opens scripts
directly into a detail view (run form + code + params), and add external
`.py`/`.R` file imports via a two-call RPC flow (preview candidates →
confirm Link/Copy per batch). Linked scripts get a persisted
`approvedFingerprint` (SHA-256) so model/pipeline runs re-request consent
when file content changed since last approval — even under allow-session —
while manual runs never get the extra prompt. A `source missing` state +
Relink completes the linked-file lifecycle; audit records gain a
linked/stored origin.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Bun runtime, React 19

**Primary Dependencies**: Electrobun 2.x (window, dialogs via
`Utils.openFileDialog`), Tailwind v4 + shadcn primitives (existing),
`sonner`, `cmdk`, `react-resizable-panels` — **no new dependencies**

**Storage**: `scripts.json` registry + `dataDir()/scripts/<id>.<ext>`
stored sources (existing `ScriptStore`, atomic temp+rename)

**Testing**: `bun test ./tests` (scoped), `bun run typecheck`,
`bun run lint`, `bun run build:renderer`

**Target Platform**: Linux desktop (Electrobun/WebKitGTK), 800×600 floor

**Performance Goals**: 200 scripts listed + grouped without lag; ≤2
clicks to any script; import+run < 30 s; ≥10 files per picker batch

**Constraints**: consent semantics identical across `tools/loop.ts` and
`fabric/runtime.ts`; linked sources re-read at open/run, never watched;
no secrets in paths/audit beyond absolute path strings

**Scale/Scope**: ~8 bun-side edits, ~8 renderer edits, 1 new dialog +
1 new sidebar group, ~6 new/updated test files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Local-first** — file dialogs + file reads are local-only; no network.
  PASS
- **Electrobun boundaries** — dialogs/file IO stay bun-side; renderer only
  invokes typed RPC. PASS
- **Strict TS + typed RPC** — all payloads in `src/shared/types.ts`; new
  RPCs ride the existing handlers map. PASS
- **shadcn/Tailwind standardization** — sidebar groups, badges, dialog,
  palette all reuse 026 primitives/tokens; no bespoke styling. PASS
- **Vite renderer pipeline** — no build changes. PASS
- **Minimal dependencies** — zero new deps (hashing via `node:crypto`/
  Bun `crypto` already in-process). PASS

**Post-design re-check**: unchanged — all gates still pass; fingerprint
field lives in the existing `ScriptEntry` (no schema break, optional).

## Project Structure

### Documentation (this feature)

```text
specs/027-scripts-workspace-external-files/
├── plan.md              # this file
├── research.md          # R1–R9 decisions
├── data-model.md        # types + invariants
├── contracts/
│   ├── rpc.md           # script.pickImport / script.import / script.relink /
│   │                    # tool.respond approveChangedSession / list rows
│   └── ui.md            # sidebar, ScriptDetail, consent variant, import dialog
├── quickstart.md        # run/test/exercise
└── tasks.md             # /speckit-tasks output (next step)
```

### Source Code (repository root)

```text
src/shared/types.ts
  └─ ScriptEntry.approvedFingerprint, ScriptListItem{linked,sourceState},
     ScriptImportCandidate/Params/Result, ScriptDecision extension,
     ToolCallRecord.contentChanged

src/bun/
├── scripts/store.ts     — upsert fingerprint handling, delete keeps external
├── scripts/service.ts   — consentState(), changedGrants, sourceState in
│                          list(), fingerprint record on consent/relink,
│                          audit origin, SCRIPT_SOURCE_MISSING
├── tools/loop.ts        — runScriptVerdict via consentState (contentChanged
│                          on ToolCallRecord, refuse source-missing)
├── fabric/runtime.ts    — same consentState switch for pipeline initiator
└── rpc/handlers.ts      — script.pickImport/import/relink; tool.respond
                           decision passthrough; script.run source-missing

src/renderer/src/
├── features/chat/AppSidebar.tsx      — Scripts NavGroup + language sub-groups
├── features/scripts/
│   ├── ScriptDetail.tsx   (new — detail/create/empty states; replaces
│   │                       ScriptsPage as surface:scripts body)
│   ├── ImportScriptsDialog.tsx (new — pickImport preview + mode + results)
│   ├── scripts-groups.ts  (new — pure grouping/sort helpers, testable)
│   ├── RunForm.tsx        (reuse)
│   ├── ScriptEditor.tsx   (reuse; external-badge/path, Advanced path field)
│   └── use-scripts.ts     (+pickImport/import/relink)
├── features/command/CommandPalette.tsx — Scripts group + import/new actions
└── features/workspace/breadcrumb.ts    — Scripts › lang › id crumbs

tests/
├── rpc/scripts.test.ts            — import/relink/pickImport/consent
├── scripts/{store,service}*       — sourceState, fingerprints, grants
└── renderer/                      — scripts-groups + consent-variant tests
```

**Structure Decision**: extends the existing feature-023 layout — no new
top-level modules; `features/scripts/` gains detail + dialog beside the
reused form/editor.

## Complexity Tracking

No violations — table intentionally empty.

## Design Notes (for /speckit-tasks)

- R3 ordering: `consentState` must land before either call site changes;
  call sites switch together so model + pipeline stay in lockstep.
- Fingerprint write points: `import link`, `relink`, `upsert external`,
  approved changed-content prompt, successful manual run.
- `script.pickImport` needs `dialogs.pickFiles` — dep is already injectable
  and headless-safe (absent ⇒ cancelled ⇒ empty candidates).
- ScriptsPage removal is coordinated: sidebar links, palette target, and
  `surface:scripts` body all move in the same task group.
- 028 integration boundary (not implemented here): `svc.call` currently
  passes `code` text to sessions; 027 keeps that path — fingerprints are
  computed at consent time, not inside the runner. 028's native host will
  re-fingerprint at exec time and refuse on drift.
