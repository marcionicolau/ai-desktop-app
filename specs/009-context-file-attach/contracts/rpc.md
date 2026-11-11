# RPC Contract Delta — 009-context-file-attach

## New method

### `attachment.pick` (request)

Opens a multi-select file dialog (main process), reads + validates each
file, persists content by id, returns metadata only.

- Params: `Record<string, never>`
- Response: `{ picked: PickedAttachment[]; rejected: RejectedFile[] } | null`
  - `null` — user cancelled the picker.
  - `PickedAttachment = { id: string; path: string; fileName: string;
    sizeBytes: number }` — `path` enables draft dedup (same file re-picked
    returns the same id).
  - `RejectedFile = { fileName: string; reason: string }` — binary/undecodable,
    over the 2 MiB read cap, or unreadable; surfaced at attach time (FR-003).
- Errors: none for per-file failures (they land in `rejected`); dialog
  failure itself is not surfaced (returns `null`).

## Changed methods

### `chat.send` — params gain optional field

```ts
params: {
  conversationId?: string;
  content: string;
  attachmentIds?: string[];   // new — resolved main-side, inject-ordered
}
```

- Unknown/expired ids are ignored silently? **No** — an unknown id
  yields `INVALID_PARAMS` ("unknown attachment id") since a silently
  dropped attachment would violate the visibility requirement.
- `attachmentIds` on a conversation-creation send works identically
  (draft conversations carry attachments on their first turn).

### `chat.regenerate` — unchanged signature

Reuses the originating user message's `attachments` records: ids are
re-resolved to the same on-disk content (FR-009).

## Events

### `chat.warning` (existing event, new producer)

Emitted once per send when the budget fit truncated or excluded files.
Reuses the existing event shape; the `code` union gains
`"ATTACHMENTS_BUDGET"`:

```ts
{ messageId: string; code: "CONTEXT_TRUNCATED" | "ATTACHMENTS_BUDGET"; message: string }
// messageId = the user message being sent
// e.g. "b.md truncated at line 412 to fit context; c.log excluded"
```

## Errors

| Code | When |
|---|---|
| `INVALID_PARAMS` | unknown attachment id in `chat.send` |
| (per-file) | binary/undecodable/oversized → `rejected[]`, not thrown |
