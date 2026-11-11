# Data Model — 009-context-file-attach

## Entities

### Attachment (main-side, persisted)

Stored at `dataDir()/attachments/<id>` — raw text content on disk;
registration metadata lives in the in-memory draft registry and inside
message records.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | filename of the content file (`<id>` under attachments/) |
| `path` | string | source path (draft registry + dedup only; not persisted on message) |
| `fileName` | string | basename shown in chips |
| `sizeBytes` | number | bytes read |
| `content` | — | file body, on disk only |

### MessageAttachment (record on the sent message)

```ts
interface MessageAttachment {
  id: string;
  fileName: string;
  sizeBytes: number;
  status: "full" | "truncated" | "excluded";
}
```

`Message.attachments?: MessageAttachment[]` — ordered in attach order.
`excluded` rows record files the budget couldn't fit (visible honesty,
FR-005); their ids remain resolvable.

## Lifecycle

1. **Pick** — `attachment.pick` → dialog → per file: read, validate
   (UTF-8, no NUL, ≤ 2 MiB), write `attachments/<id>`, return metadata.
   Same resolved path re-picked → same id (dedup).
2. **Draft** — renderer holds `{id, fileName, sizeBytes}[]` chips; ×
   removes the chip only (file stays on disk; unreferenced files are
   reclaimed when the owning conversation is deleted).
3. **Send** — `chat.send{attachmentIds}` → resolve → budget-fit blocks →
   prepend to user turn → persist `Message.attachments` with per-file
   `status` → `chat.warning` for any truncated/excluded.
4. **Regenerate** — ids re-resolved from the user message record → same
   content → same injection (deterministic, FR-009).
5. **Delete** — `conversation.delete` removes attachment files whose ids
   the deleted conversation referenced.

## Invariants

- Renderer never holds attachment content.
- Every `MessageAttachment.id` in a live conversation resolves to an
  existing `attachments/<id>` file.
- `status` is assigned at send time and never changes afterwards.
- Attachment records ride along on branching/export for free — they're
  ordinary message fields (no special-casing needed in 005/008 paths).
