# RPC Contract — Export & Import

Additions to `src/shared/rpc-contract.ts`. Existing methods unchanged.

## New requests

| Method | Params | Response | Errors |
|---|---|---|---|
| `conversation.export` | `{ conversationId: string; format: "markdown" \| "json" }` | `{ path: string \| null }` | `NOT_FOUND` (conv), `INVALID_PARAMS` (format) |
| `conversation.import` | `Record<string, never>` | `{ conversationId: string \| null }` | `INVALID_PARAMS` (malformed/unsupported file) |
| `backup.export` | `Record<string, never>` | `{ path: string \| null }` | — |
| `backup.import` | `Record<string, never>` | `{ imported: number \| null }` | `INVALID_PARAMS` |

## Semantics

- **Export**: opens a folder picker inside the handler; writes
  `<slug>-<id8>.md|.json` into the chosen folder (dedup `-2` suffix);
  `path: null` when the user cancels. Markdown renders the active path;
  JSON emits the D1 envelope (`kind="conversation"`).
- **Import**: opens a `.json` file picker; validates via `parseEnvelope`
  (all checks before any write — FR-006); remaps every id through a
  fresh uuid map (D3); persists via `saveConversation`; returns the new
  id. `conversationId: null` when cancelled. Only `kind="conversation"`
  files are accepted (`INVALID_PARAMS` "expected conversation export"
  on backup).
- **backup.export**: one envelope with every conversation + settings +
  tags (`kind="backup"`).
- **backup.import**: accepts only `kind="backup"`; restores all
  conversations (each remapped) + settings + merged tags in one pass.
  Bindings to absent files stay bound → surface as `broken` (FR-008).
  `imported: null` when cancelled; otherwise the conversation count.

## Events

Unchanged. `conversation.list` reflects imports on next renderer poll
(`refreshList` after import resolves — same pattern as rename/delete).

## Sequencing invariants

- Import is allowed during generation (writes a NEW conversation; the
  in-flight turn is untouched). Export snapshots current state —
  `generating` messages export with their status label.
- `conversation.import` is atomic: validation + remap complete before
  `saveConversation`; a failure leaves the store byte-identical.
