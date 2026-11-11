# Validation — 009-context-file-attach

Automated evidence is in `tests/attachments/` and `tests/rpc/attachments.test.ts`
(20 tests, all passing — 167 total suite-wide). The quickstart scenarios map onto
them as follows.

## VS-1 — Attach files to a prompt

- `attachment.pick` opens a multi-select file dialog (`pickFiles`, falling back
  to the single-file `pickFile`), reads + validates in the main process, and
  returns `{picked: [{id, path, fileName, sizeBytes}], rejected: [{fileName,
  reason}]}` — content never crosses the RPC boundary (FR-010).
- Validation rejects binary content (NUL bytes / invalid UTF-8) and files over
  the 2 MiB read cap with per-file reasons (FR-003 / SC-004) —
  `binary file rejected`, `invalid UTF-8 rejected`.
- Re-picking the same path dedups to the same id (FR-007) — `same path
  re-picked dedups`.
- Cancelled picker → `null`, UI stays silent — `picker cancel returns null`.
- Composer renders removable name+size chips; sending passes
  `attachmentIds` through `chat.send` and records `Message.attachments`
  with per-file status (`full`/`truncated`/`excluded`).

## VS-2 — Injection affects the answer

- Attachment content is folded into the current user turn as
  `<file name="…">…</file>` blocks appended after the prompt text, so
  `buildPrompt` always budgets it ahead of history (FR-004) —
  `pick → send injects blocks into the prompt`.
- Unknown ids are rejected with `INVALID_PARAMS` (never silently dropped) —
  `unknown attachment id → INVALID_PARAMS`.
- SC-001: the assistant's `lastPrompt` captured by the fake engine contains the
  file content — verified in `pick → send injects`.

## VS-3 — Graceful budget overflow

- `fitBudget` includes files in attach order until the reserved budget runs
  out; the first non-fitting file is truncated at a line boundary with a
  `… [truncated]` marker, remaining files are `excluded` (FR-005) —
  `truncated file cut at a line boundary`, `oversized attachment truncated +
  warning emitted`.
- A `chat.warning` event `{messageId, code: "ATTACHMENTS_BUDGET", message}`
  names truncated and excluded files — asserted in the oversized-attachment
  test and surfaced in the Composer notice area.
- Status chips on the user message show `·trunc` / `·skipped` styling.
- SC-002: a 10×-over-budget attachment still produces a successful send with a
  truncated record and a warning.

## VS-4 — Fusion split, regenerate, lifecycle

- Planner sees a name/size summary line (`Attached files: a.ts (12 KB)…`)
  while the executor receives the full blocks — `planner summary lists names +
  sizes only` (FR-008); `chat.send` passes `plannerText` separately so
  `runFusionTurn` uses it for the plan phase.
- `chat.regenerate` re-reads the persisted user message's attachment ids and
  reinjects the same on-disk content — `regenerate reinjects the original
  attachment ids` (FR-009).
- `conversation.delete` unlinks attachment files referenced only by that
  conversation; ids still referenced elsewhere survive — `delete gc removes
  unreferenced files` (gcFor).
- SC-003: `getConversation` after reload returns the persisted
  `attachments` records (asserted in `pick → send injects`).

## Gates

- `bun test ./tests` — 167 pass / 0 fail (was 147 at 008: +20 attachment tests)
- `bun run typecheck` (`tsc --noEmit`) — clean
- `bun run lint` (`oxlint`) — clean
- `hutch run build` — `canary-linux-x64` build complete
