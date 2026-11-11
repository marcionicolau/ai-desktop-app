# Tasks: Conversation Export & Import

**Input**: Design documents from `/specs/008-export-import/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/rpc.md, quickstart.md

**Branch note**: `008-export-import` forked before feature 005 merged —
rebase onto `main` BEFORE T003 so `store/tree.ts` (`pathOf`) is
available for the Markdown renderer and variant-tree exports.

**Organization**: grouped by user story (US1 export → US2 import →
US3 backup) so each ships independently.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup & Foundational

- [X] T001 Create `src/shared/export.ts`: `EXPORT_FORMAT_VERSION = 1`, `ExportEnvelope`, `ExportedConversation = Conversation`, `ExportedSettings` (`generation`, `modelOverrides`, `contextLimitWarning`, `activeModel` basename-only per FR-003).
- [X] T002 `src/shared/rpc-contract.ts`: add `conversation.export {conversationId, format:"markdown"|"json"} → {path: string|null}`, `conversation.import {} → {conversationId: string|null}`, `backup.export {} → {path: string|null}`, `backup.import {} → {imported: number|null}`.
- [X] T003 Create `src/bun/export/exporter.ts`: `buildEnvelope(conv)` (kind="conversation") and `buildBackupEnvelope(convs, settings, tags)` (kind="backup"); `renderMarkdown(conv)` — `pathOf` active path, `**You**`/`**Assistant**` blocks with `createdAt`, fenced code verbatim, plan in `<details><summary>Plan`, `*(variant k of N — others not shown)*` markers (research D4); `activeModelPath` → basename `activeModel` (D2); `slugify(title)` + unique `-N` filename helper. PREREQ: rebase `008-export-import` onto `main` first so `src/bun/store/tree.ts` exists.
- [X] T004 Create `src/bun/export/importer.ts`: `parseEnvelope(raw)` — all data-model.md validation checks throw `INVALID_PARAMS` before any write (malformed JSON, `formatVersion !== 1`, unknown kind, empty conversations, malformed message at index i); `remapConversation(conv)` — fresh conv id + `idMap` for all messages, `parentId`/`activeLeaf` rewritten (dangling → null), append ` (imported)` title only on title collision (D3); `toSettings(imported, modelsDir)` — resolve `activeModel` basename → path if file exists else null, merge with `provisionTags` defaults.
- [X] T005 [P] Create `tests/export/exporter.test.ts`: envelope shape/version/kind, `activeModel` is a basename, NO absolute paths anywhere in serialized output (scan for `/` prefix and `^X:\`), markdown renders active path only + variant markers + plan `<details>`, generating/failed messages keep status labels.
- [X] T006 [P] Create `tests/export/importer.test.ts`: round-trip envelope→parse→remap preserves all message content + tree shape; id remap produces fresh ids with intact `parentId`/`activeLeaf` links; malformed JSON, wrong `formatVersion`, wrong kind, missing message fields each → `INVALID_PARAMS` with descriptive message; importing a `kind:"backup"` envelope via conversation path rejects.
- [X] T007 `src/bun/rpc/handlers.ts`: add `dialogs` to `HandlerDeps` — `pickFolder()`/`pickFile()` wrappers over `Utils.openFileDialog` (defaults), injectable for tests (model.pick's direct `Utils` call stays as-is); wire module-level dep in `createRpc`.

## Phase 2: US1 — Export one conversation (P1)

**Goal**: conv menu export → folder pick → `.md` transcript or `.json`
envelope on disk.

**Independent Test**: export a conversation to each format and open the
files (VS-1).

- [X] T008 [US1] `src/bun/rpc/handlers.ts` `conversation.export`: `NOT_FOUND` on missing conv, `INVALID_PARAMS` on bad format; folder pick via `dialogs.pickFolder` (cancel → `{path:null}`); JSON → `buildEnvelope` write, Markdown → `renderMarkdown` write; file name `<slug>-<id8>.md|json` dedup `-2`; return `{path}`.
- [X] T009 [US1] Create `tests/rpc/export.test.ts`: `conversation.export` with injected `pickFolder` → file written to tmp dir, correct envelope/markdown, `path` returned; cancel → `{path:null}`; `NOT_FOUND`/`INVALID_PARAMS` paths; written JSON re-parses through `parseEnvelope`.
- [X] T010 [US1] `src/renderer/src/features/chat/Sidebar.tsx`: add a per-conversation inline action icon (Download, consistent with existing edit/delete affordances) → format choice (Markdown/JSON) → `conversation.export` → transient notice with written path (or silent on cancel).

## Phase 3: US2 — Import a conversation (P2)

**Goal**: `.json` file pick → validated, remapped, new conversation.

**Independent Test**: export → delete → import → identical content
restored (VS-2).

- [X] T011 [US2] `src/bun/rpc/handlers.ts` `conversation.import`: file pick via `dialogs.pickFile` (`.json`, single; cancel → `{conversationId:null}`); `parseEnvelope` (reject `kind:"backup"` with INVALID_PARAMS "expected conversation export"); `remapConversation` → `saveConversation`; return `{conversationId}`.
- [X] T012 [US2] Extend `tests/rpc/export.test.ts`: import valid export → new conv in fake store, content identical, ids remapped; double-import → two distinct conversations; malformed file → INVALID_PARAMS + store untouched; backup-kind file → INVALID_PARAMS.
- [X] T013 [US2] `src/renderer/src/features/chat/Sidebar.tsx`: "Import conversation" button → `conversation.import` → `refreshList` + select the new id; error surfaces via existing `lastError` banner.

## Phase 4: US3 — Full backup & restore (P3)

**Goal**: one archive = all conversations + settings + tags; restore on
fresh install with degraded-tag tolerance (VS-3).

- [X] T014 [US3] `src/bun/rpc/handlers.ts` `backup.export`: folder pick → `buildBackupEnvelope` over every stored conversation + `ExportedSettings` + `settings.tags` → write `backup-<date>.json`.
- [X] T015 [US3] `src/bun/rpc/handlers.ts` `backup.import`: file pick (cancel → `{imported:null}`); `parseEnvelope` requires `kind:"backup"`; remap + save each conversation; `toSettings` → `saveSettings` (absent-model bindings stay bound → `broken` state per FR-008); return `{imported: n}`.
- [X] T016 [US3] Extend `tests/rpc/export.test.ts`: backup export writes envelope with all convs+settings+tags; fresh-store backup.import restores conversations and merges tags; binding to a nonexistent model file keeps the tag bound (surfaces `broken` via roles.list) without throwing.
- [X] T017 [US3] Create `src/renderer/src/features/settings/DataPanel.tsx` ("Export backup…" / "Import backup…" + result notice) and wire into `ChatPage.tsx` toolbar popover area.

## Phase 5: Polish & Cross-Cutting

- [X] T018 Validation: VS-1…VS-4 results + 500-message export timing (SC-002 <2 s) written to `specs/008-export-import/validation.md`.
- [X] T019 Gates + docs: `bun run typecheck`, `bun run lint`, `bun test ./tests`, `bun run build:renderer`, `bun run build:native` all green; update `AGENTS.md` (export/importer modules, 4 RPC methods, envelope version, folder-pick pattern, id-remap invariant).

## Dependencies

```text
Phase 1 (T001–T007) → all story phases
US1 (Phase 2) — needs Phase 1 — MVP
US2 (Phase 3) — needs T004/T006 + T007; independently testable
US3 (Phase 4) — needs Phase 1 + T011/T013 patterns
Phase 5 — needs US1–US3
```

## Parallel Opportunities

- T005 ∥ T006 (separate test files, T003/T004 define their contracts).
- T010 (Sidebar export UI) ∥ T008/T009 (handler+tests) after T002.
- T013 (import UI) ∥ T011/T012.

## Implementation Strategy

**MVP = Phase 1 + US1** (T001–T010): export alone is shippable.
**Then US2** (round-trip), **then US3** (backup/restore).
Commit per task or per logical group via
`.specify/extensions/git/scripts/bash/auto-commit.sh <phase> --message-file <f>`.
