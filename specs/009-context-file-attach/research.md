# Research — 009-context-file-attach

## D1: Attachment content lives main-side, keyed by id

`attachment.pick` (new RPC) opens a multi-select file dialog via the
injectable `dialogs` dep, reads each file with `Bun.file`, validates it
(UTF-8 decodable, no NUL bytes, ≤ 2 MiB), persists content to
`dataDir()/attachments/<id>` and returns **metadata only** —
`{id, path, fileName, sizeBytes}` plus a `rejected[]` list carrying
per-file reasons for binary/undecodable/oversized picks (FR-003, at
attach time not send time).

Rationale: FR-010 says file access goes through the main process and the
renderer never needs content (chips show name/size). Returning metadata
only also keeps multi-MB payloads out of the RPC bridge entirely.

Rejected: sending file contents back to the renderer and re-submitting
them in `chat.send` — doubles bridge traffic, breaks FR-010's spirit.
Rejected: renderer-side `fetch(file://)` — webview file access is not the
typed-RPC boundary.

Dedup (FR-007): `attachment.pick` returns the existing id when the same
resolved path is picked while already registered in the draft set; the
renderer also dedups chips by id.

## D2: Injection = file blocks prepended to the user turn

Each included attachment renders as:

```
<file name="relative/or/base/name.ts" size="1234">
…content…
</file>
```

concatenated ahead of the user's text, all inside the single `current`
turn passed to `buildPrompt`. Because `buildPrompt` always keeps
`current` and budgets history around it, attachments are included ahead
of history truncation (FR-004) with zero prompt-builder changes.

Budget fit (FR-005): blocks are added in attach order while they fit the
prompt budget (minus the user text). The first file that doesn't fit is
truncated at a line boundary with a `\n… [truncated]` marker; files after
it are excluded. Both cases emit `chat.warning` (existing event) and are
recorded per-file as `status: "truncated" | "excluded"` vs `"full"` —
the warning survives in history via the message record.

Rejected: mid-file hard cut — breaks symbols/lines and produces
confidently-wrong reads. Rejected: per-file proportional shrink —
unpredictable, still loses content silently.

## D3: `Message.attachments` record + disk persistence

`Message` gains `attachments?: MessageAttachment[]` where
`MessageAttachment = {id, fileName, sizeBytes, status}`.

- History display (FR-006, SC-003): the record alone is enough — chips
  render name/size/status from the persisted message.
- Regenerate (FR-009): `chat.regenerate` re-resolves the user message's
  attachment ids → `attachments/<id>` files → identical injection.
  Deterministic per spec ("content read at attach time").
- GC: `conversation.delete` unlinks `attachments/<id>` for ids not
  referenced elsewhere (per-conversation attachment files keep this
  trivial — one file per attachment, referenced by one message).

Rejected: embedding content in the message JSON — multi-MB attachments
bloat every conversation read/write. Rejected: re-reading the source
path at regenerate — non-deterministic if the file changed on disk.

## D4: Fusion split

- **Planner** gets the user instruction plus a summary line:
  `Attached files: a.ts (12.0 KB), b.md (3.1 KB)` — enough to plan around
  without burning planner context.
- **Executor** receives the same `<file>` blocks as single mode.

`runFusionTurn` takes an extra optional `attachments` param already
resolved by the caller, so injection logic isn't duplicated inside
fusion.

## D5: Caps

- Per-file read cap: **2 MiB** — beyond that the file is rejected at
  pick time with a reason (not silently truncated; spec's oversized
  handling governs the *prompt budget*, not unbounded reads).
- Total attachment spend: bounded by the existing prompt budget — they
  squeeze history first (D2), and only truncate each other when the
  files alone overflow the whole budget. No separate fixed cap: a
  500-token file and a 500 KB file both fit their real constraint.
