# Validation — 008-export-import

Automated evidence is in `tests/export/` and `tests/rpc/export.test.ts`
(36 tests, all passing). The quickstart scenarios map onto them as follows.

## VS-1 — Export one conversation

- `conversation.export` with `format: "json"` writes `<slug>-<id8>.json`
  containing a `formatVersion: 1` / `kind: "conversation"` envelope with the
  conversation verbatim — verified by re-parsing the written file
  (`writes a JSON envelope that re-parses`).
- `format: "markdown"` writes a `.md` transcript of the **active path only**:
  dead-branch variants are excluded and surfaced as `*(variant k of N — others
  not shown)*` markers; fusion plan phases render as
  `<details><summary>Plan — tag · file.gguf</summary>` blocks; non-complete
  statuses get `*(partial|failed|generating)*` labels (exporter unit tests +
  `writes markdown with the active path only`).
- Cancelled folder picker → `{path: null}`, no write, UI stays silent.
- Missing conversation → `NOT_FOUND`; invalid format → `INVALID_PARAMS`.
- Repeat export into the same folder dedupes as `…-2.json`.
- **FR-003**: serialized backup output is asserted to contain no absolute
  path strings (`/home/…`, `C:\…`); `activeModelPath` exports as basename only.

## VS-2 — Import a JSON export

- `conversation.import` picks a `.json` file, validates the envelope
  (version, app, kind, non-empty `conversations[]`, per-message field shape)
  **before any write**, then remaps every conversation + message id.
- Round-trip test: export → import into a fresh store preserves the
  parentId/activeLeaf tree shape with all-fresh ids (SC-001 — content and
  metadata identical, ids differ).
- Collision safety (FR-005): importing the same file twice yields two
  distinct conversations; title clashes get ` (imported)` appended.
- Malformed input → typed `INVALID_PARAMS` naming the problem (`not a JSON
  file`, `unsupported format version 99`, `unknown export kind`,
  `malformed message at index N`) with **zero partial writes** (SC-004).
- A `kind: "backup"` envelope through the conversation path is rejected.
- Multi-entry `conversations[]`: every entry imports; the first new id is
  returned and selected in the UI.
- Dangling `parentId`/`activeLeaf` references collapse to `null`/`last
  message` instead of corrupting the tree.

## VS-3 — Full backup & restore

- `backup.export` writes a `kind: "backup"` envelope with **all**
  conversations plus `ExportedSettings` (generation, modelOverrides,
  contextLimitWarning, basename `activeModel`) and the tag list.
- `backup.import` restores every conversation (id-remapped, collision-safe),
  merges restored tags with locally-provisioned ones, and resolves
  `activeModel` to a path **only if the file exists** — absent bindings are
  kept verbatim and surface as `broken` role state (FR-008), never a failure.
- Fresh-store restore verified: 2-conversation backup → new store gets both
  plus settings + tags; existing conversations are never overwritten.
- Cross-kind misuse rejected: conversation envelope → `backup.import` and
  backup envelope → `conversation.import` both `INVALID_PARAMS`.
- Cancelled pickers → `null` results (`{path:null}` / `{imported:null}`).

## VS-4 — Errors & edge cases

Covered by the importer unit tests + RPC tests: wrong version, wrong app,
wrong kind, empty conversations, malformed message fields, non-JSON input —
all `INVALID_PARAMS`, all before any persistence call.

## Performance — SC-002

Measured on a 500-message conversation (alternating user/assistant, ~520 B
per message):

```
json: 0.75ms (260 KiB)   md: 81.48ms (146 KiB)
```

Both formats are far under the 2 s criterion.

## Offline — FR-010

Export/import perform only local file I/O (`readFileSync`/`writeFileSync` to
a user-picked path) — no network access anywhere on the path.

## Gates (SC-005)

- `bun test ./tests`: **147 pass, 0 fail** (22 files; +36 new for 008)
- `bun run typecheck`: clean
- `bun run lint`: clean
- `bun run build:renderer`: builds

Manual GUI check (folder/file pickers are native dialogs — not automatable
headless): export a conversation to both formats, import the JSON back,
export+restore a full backup, and confirm the sidebar notice shows the
written path or stays silent on cancel.
