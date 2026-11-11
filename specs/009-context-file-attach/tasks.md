# Tasks: Attach Files as Turn Context

**Input**: spec.md, plan.md, research.md, data-model.md, contracts/rpc.md
**Tests**: included — every module gets unit coverage before wiring.

## Phase 1 — Foundational

- [x] T001 Add `MessageAttachment` (`{id, fileName, sizeBytes, status:
  "full"|"truncated"|"excluded"}`) and `Message.attachments?:
  MessageAttachment[]` to `src/shared/types.ts`.
- [x] T002 Add `attachment.pick` request/response and
  `attachmentIds?: string[]` on `chat.send` params to
  `src/shared/rpc-contract.ts` (contract: contracts/rpc.md).
- [x] T003 Create `src/bun/attachments/store.ts`: `pickAndStore(paths)`
  reads each file (Bun.file), rejects non-UTF-8/NUL-byte/>2 MiB with
  per-file reasons, persists content at `dataDir()/attachments/<id>`,
  dedups by resolved path (re-pick returns same id); `resolve(ids)`
  returns `{id, fileName, sizeBytes, content}` or throws typed
  `INVALID_PARAMS` for unknown ids; `gcFor(conversation)` unlinks
  attachment files referenced only by it.
- [x] T004 Create `src/bun/attachments/inject.ts`: `buildBlocks(atts)`
  renders `<file name="…" size="…">` blocks; `fitBudget(atts,
  userContent, budget)` includes in attach order until the budget is
  spent — first non-fitting file truncated at a line boundary with
  `\n… [truncated]` marker, the rest excluded; returns
  `{injectText, statuses, warnings}`; `plannerSummary(atts)` builds the
  `Attached files: name (size), …` line for fusion.
- [x] T005 [P] Add `tests/attachments/store.test.ts`: valid file stores +
  resolves; binary/NUL rejected with reason; oversized rejected; dedup
  returns same id; unknown id → `INVALID_PARAMS`; gc removes files.
- [x] T006 [P] Add `tests/attachments/inject.test.ts`: block format;
  attach-order inclusion; line-boundary truncation + marker; exclusion
  statuses + warnings; planner summary line.

## Phase 2 — US1 (P1): attach → chips → send → record

- [x] T007 [US1] PREREQ: this branch predates the 008 merge — rebase
  onto `main` first so `HandlerDeps.dialogs` exists. Then extend the
  `dialogs` dep with a multi-select `pickFiles()` and implement the
  `attachment.pick` handler in
  `src/bun/rpc/handlers.ts` returning `{picked, rejected} | null`;
  wire the real picker in `createRpc` (`canChooseFiles`,
  `allowsMultipleSelection`).
- [x] T008 [US1] Wire `chat.send` `attachmentIds` in
  `src/bun/rpc/handlers.ts`: resolve ids (unknown → `INVALID_PARAMS`),
  inject blocks ahead of user text, persist `Message.attachments`
  records on the user message.
- [x] T009 [US1] Add `tests/rpc/attachments.test.ts`: pick → send →
  prompt contains file content (assert via lastPrompt capture like
  chat tests); message record persisted AND survives a getConversation
  reload (SC-003); unknown id fails; dedup via re-pick.
- [x] T010 [US1] Composer: paperclip button + removable attachment
  chips (name · size, ×) in `src/renderer/src/features/chat/
  Composer.tsx`; draft attachment state + rejected-file notice in
  `use-chat.ts`; pass `attachmentIds` on send and clear chips.
- [x] T011 [US1] Render `Message.attachments` chips on user messages in
  `src/renderer/src/features/chat/MessageList.tsx` (name · size ·
  status marker).

## Phase 3 — US2 (P2): graceful budget overflow

- [x] T012 [US2] Wire `fitBudget` into `chat.send` (and the fusion path):
  apply per-file statuses to the `Message.attachments` records and emit
  `chat.warning` listing truncated/excluded files when any exist.
- [x] T013 [US2] Extend `tests/rpc/attachments.test.ts`: oversized
  attachment still generates (SC-002), `chat.warning` emitted with the
  truncated/excluded names, statuses recorded on the message.
- [x] T014 [US2] Surface status on chips: truncated/excluded styling in
  `MessageList.tsx` chips; confirm `chat.warning` already renders
  through the existing notice path in `use-chat.ts`.

## Phase 4 — Fusion + regenerate + lifecycle

- [x] T015 Wire attachments through fusion + regenerate in
  `src/bun/rpc/handlers.ts`/`src/bun/llama/fusion.ts`: planner prompt
  gets `plannerSummary`, executor gets full blocks — inject at the call
  site or via a `runFusionTurn` param, whichever is cleaner (FR-008);
  `chat.regenerate` re-resolves the user message's attachment ids to
  the same on-disk content (FR-009); `conversation.delete` calls
  `gcFor`.
- [x] T016 Tests: regenerate reuse (same ids → same injected content),
  fusion split (planner sees names/sizes only, executor sees content),
  delete-gc removes files — in `tests/rpc/attachments.test.ts` /
  `tests/attachments/`.

## Phase 5 — Polish

- [x] T017 Write `specs/009-context-file-attach/validation.md` mapping
  VS-1…VS-4 to the automated tests; note the manual picker pass.
- [x] T018 Run all gates (`bun test`, typecheck, lint, build:renderer,
  build:native), update `AGENTS.md` module map, mark all tasks `[X]`.

## Dependencies

T003/T004 ∥ after T001; T005/T006 ∥ implementation; handlers (T007/T008)
before UI (T010/T011); T012 needs T004+T008; T015 needs T008; polish
last. MVP = T001–T011 (US1 alone ships).
