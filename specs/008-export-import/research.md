# Research — Conversation Export & Import

## D1: Single versioned envelope, `kind` discriminator

One format serves both export scopes:

```ts
{ formatVersion: 1, app: "ai-desktop-app", kind: "conversation"|"backup",
  exportedAt: string,
  conversations: ExportedConversation[],   // 1 elem for kind=conversation
  settings?: ExportedSettings,             // kind=backup only
  tags?: ModelTag[] }
```

`ExportedConversation` mirrors `Conversation` verbatim (id, title,
createdAt, updatedAt, mode, plannerTag, executorTag, activeLeaf,
messages[] with parentId). Rationale: round-trip fidelity beats a
curated field subset; importing is the mirror of `getConversation`
output minus machine-local bits. Rejected: a slim "portable" schema —
invented fields to maintain and loses phases/variants.

## D2: Machine-path hygiene — basenames only

`Settings` is the only store with absolute paths: `activeModelPath`.
Exports carry `settings: { generation, modelOverrides, tags,
activeModel: fileName | null }` — `activeModelPath` reduced to its
basename; `contextLimitWarning` included (harmless). `ModelTag.binding`
and `fallback` refs are already file basenames/tag names — export
verbatim. A scan guard in `importer.test` asserts no field matches
`/` or `^[A-Za-z]:\\` patterns (FR-003).

## D3: Import always remaps ids (collision-safe by construction)

`importConversation` mints a new `conversation.id` and a
`Map<oldId,newId>` for every message; `parentId` and `activeLeaf`
rewrite through the map (dangling refs → null/nearest ancestor). Never
attempts "keep id if free" — deterministic behavior, no TOCTOU, and the
same code path serves both "re-import own export" and "import foreign
file". Title: keep verbatim, append ` (imported)` only when an
identical title already exists *and* the import is a fresh copy (nice
sidebar distinguisher).

## D4: Markdown = active path transcript + variant markers

Rendered from `pathOf(conv)` (tree-aware, feature 005): `**You**` /
`**Assistant**` speaker blocks, `createdAt` timestamps, fenced code
preserved verbatim, fusion plan in `<details><summary>Plan …` blocks,
`*(variant k of N — others not shown)*` markers on messages with
siblings. Messages still `generating`/`failed` keep status labels.
Rejected: exporting all variants — Markdown is a human transcript; JSON
is the lossless format (and VS-1's independent test only requires a
clean transcript).

## D5: Dialog-in-handler, generated file names

Exports: `Utils.openFileDialog({ canChooseDirectory: true,
canChooseFiles: false, allowsMultipleSelection: false })` → folder pick
(there is no save dialog in Electrobun 2.x — verified devkit API).
Handler writes `<slug-title>-<id8>.md|json` (dedup `-2`) and returns
`{ path: string | null }` (null = cancelled). Imports: standard file
pick filtered to `json`. Writes use `Bun.write` then the response
reports the absolute path — the *export artifact* itself stays
path-free (D2). Rejected: fixed exports dir — makes the user hunt for
the file.

## Rejected alternatives

- **Streamed export** — SC-002 (500 msgs < 2 s) is trivially met by
  `JSON.stringify` (~ms); revisit only for multi-MB backups.
- **Merging imported settings with local** — backup semantics = restore;
  degraded bindings (`broken` state) already surface in `RolesService`.
