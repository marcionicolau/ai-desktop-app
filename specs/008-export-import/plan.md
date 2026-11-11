# Implementation Plan: Conversation Export & Import

**Branch**: `008-export-import` | **Date**: 2025-12-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-export-import/spec.md`

## Summary

Local-first data portability: export any conversation to Markdown
(transcript) or JSON (versioned envelope), import JSON exports with
collision-safe id remapping, and full backup/restore covering
conversations + settings + role tags. All file I/O stays in the bun
process behind typed RPC (`conversation.export`/`conversation.import`/
`backup.export`/`backup.import`), using Electrobun's `openFileDialog`
(folder pick for exports, file pick for imports) — consistent with the
existing `model.pick` pattern. Exports strip machine-local paths
(FR-003); imports mint fresh ids through a remap map so `parentId`/
`activeLeaf` trees (feature 005) survive intact with zero overwrite risk.

## Technical Context

**Language/Version**: TypeScript strict, Bun 1.4.x
**Primary Dependencies**: Electrobun 2.x (`Utils.openFileDialog`), Bun.file I/O
**Storage**: JSON documents (existing `store/json-store.ts`)
**Testing**: `bun test` — pure serializer/importer unit tests + RPC contract tests
**Target Platform**: Linux/macOS/Windows desktop via Electrobun
**Performance Goals**: 500-message conversation export < 2 s (SC-002)
**Constraints**: fully offline (FR-010), no new dependencies, atomic writes

## Constitution Check

| Gate | Status | Evidence |
|---|---|---|
| Typed RPC boundary | PASS | four new methods on `ChatRpcSchema`; no ad-hoc IPC |
| Native isolation | PASS | no FFI changes; file I/O via `node:fs`/`Bun.file` only |
| Local-first | PASS | FR-010; no network calls anywhere in the feature |
| Atomic persistence | PASS | imports write via existing `saveConversation`/`saveSettings` (tmp+rename) |
| No new deps | PASS | validation is hand-rolled (schema check ~60 LOC) |

## Module map

```text
src/
├── shared/
│   ├── types.ts            (no change)
│   ├── export.ts           NEW — envelope + wire types, FORMAT_VERSION
│   └── rpc-contract.ts     (4 new methods, 1 new error code optional)
├── bun/
│   ├── export/
│   │   ├── exporter.ts     NEW — buildEnvelope(), renderMarkdown()
│   │   └── importer.ts     NEW — parseEnvelope() validation, remapIds()
│   ├── store/json-store.ts (export allConversations helper? — read-only list already exists)
│   └── rpc/handlers.ts     (4 handlers + dialog wiring)
└── renderer/src/
    ├── features/chat/Sidebar.tsx       (export submenu per conv, import btn)
    └── features/settings/DataPanel.tsx  NEW — backup export/restore
tests/
├── export/exporter.test.ts
├── export/importer.test.ts
└── rpc/export.test.ts
```

## Phase structure

- **US1 (P1)**: `shared/export.ts` + `exporter.ts` + `conversation.export`
  + Sidebar export menu → JSON & Markdown files.
- **US2 (P2)**: `importer.ts` + `conversation.import` + Sidebar import
  button → round-trip restore with fresh ids.
- **US3 (P3)**: backup envelope extension + `backup.export`/`backup.import`
  + `DataPanel` → full-state migration with degraded-tag tolerance.

## Design decisions → research.md

Envelope format, path stripping, id remapping, Markdown semantics,
dialog UX — five decisions recorded.
