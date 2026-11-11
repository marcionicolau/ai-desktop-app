# Implementation Plan: Attach Files as Turn Context

**Branch**: `009-context-file-attach` | **Spec**: [spec.md](spec.md)

## Summary

Let users attach local text files to a draft turn. Picked files are read
and validated entirely in the main process (FR-010) and persisted by id;
at send time their contents are injected into the prompt ahead of history
truncation, budgeted deterministically, and recorded on the sent message
as name/size/status chips — surviving restart and re-used verbatim on
regenerate.

## Technical Context

- Electrobun 2.x main + webview, Bun 1.4.x, TS strict — same stack, no
  new dependencies.
- `Utils.openFileDialog` supports `canChooseFiles + allowsMultipleSelection`
  (verified in 008); same injectable `dialogs` dep pattern.
- `buildPrompt(history, current, {budget})` always keeps `current` — so
  attachments folded into the user turn are included *before* history
  truncation (FR-004 falls out for free).
- `chat.warning` event already exists in the contract — used for
  truncation/exclusion notices (FR-005).
- Fusion (`runFusionTurn`) takes a resolved executor user message + a
  planner instruction string — attachments inject differently per phase.

## Constitution Check

- Typed RPC only (new `attachment.pick`; `chat.send` gains
  `attachmentIds?`) — renderer never touches the filesystem. PASS.
- No FFI/native changes; no new deps; offline-only (attach = local read).
  PASS.

## Design Decisions (see research.md)

- **D1** — main-side attachment registry: `attachment.pick` reads +
  validates files, stores content at `dataDir()/attachments/<id>`,
  returns metadata only. Content never enters the renderer.
- **D2** — prompt injection: `<file name="…">` blocks prepended to the
  user turn; inclusion in attach order until the prompt budget is spent;
  line-boundary truncation + `… [truncated]` marker; excluded files →
  `chat.warning`.
- **D3** — `Message.attachments` records `{id, fileName, sizeBytes,
  status}` (status: full/truncated/excluded); ids let regenerate re-pull
  content from disk (FR-009, SC-003).
- **D4** — fusion: planner gets a one-line attachment summary; executor
  gets full file blocks.
- **D5** — caps: 2 MiB per-file read cap; attachment spend bounded by the
  same prompt budget (they squeeze history, and truncate each other only
  when they alone overflow it).

## Module Map

- `src/shared/types.ts` — `MessageAttachment`; `Message.attachments?`.
- `src/shared/rpc-contract.ts` — `attachment.pick`; `chat.send`
  `attachmentIds?: string[]`.
- `src/bun/attachments/store.ts` — validate (UTF-8/NUL, size cap),
  persist, resolve, gc on conversation delete.
- `src/bun/attachments/inject.ts` — build file blocks, budget fit,
  truncation markers, summary line for planner.
- `src/bun/rpc/handlers.ts` — `attachment.pick` handler; `chat.send`/
  regenerate/fusion wiring; gc hook in `conversation.delete`.
- `src/renderer/.../Composer.tsx` — paperclip + removable chips.
- `src/renderer/.../MessageList.tsx` — attachment chips on user messages.
- Tests: `tests/attachments/*`, `tests/rpc/attachments.test.ts`.

## Milestones

MVP = US1 (pick → chips → send → content-aware answer + record). US2 adds
budget-overflow warnings; fusion + regenerate reuse ride along on D3/D4.
