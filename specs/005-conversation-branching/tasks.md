# Tasks: Conversation Branching & Message Trees

**Input**: Design documents from `/specs/005-conversation-branching/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/rpc.md, quickstart.md

**Organization**: Tasks grouped by user story (US1 regenerate-variants →
US2 edit-branches → US3 overview) so each ships independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no deps on incomplete tasks)
- **[USn]**: story this task belongs to

## Phase 1: Setup & Foundational

Tree primitives + persistence that all stories depend on.

- [X] T001 Extend `src/shared/types.ts`: `Message.parentId?: string | null`, `Conversation.activeLeaf?: string | null`; doc comments per data-model.md invariants.
- [X] T002 Create `src/bun/store/tree.ts` — pure tree ops: `pathOf(conv)`, `siblings(conv, m)`, `children(conv, m)`, `deepestLeaf(conv, m)` (latest-`createdAt` tiebreak), `variantIndex(m) → { pos, total }`. No I/O.
- [X] T003 `src/bun/store/json-store.ts`: lazy linear backfill on load — `messages[i].parentId = messages[i-1].id`, `activeLeaf` = last id — for pre-005 data (same pattern as 004 field defaults); write-through on next save.
- [X] T004 `src/shared/rpc-contract.ts`: add `message.selectVariant { messageId } → { activeLeaf }`; extend `Conversation` response type (parentId/activeLeaf flow through); error codes `NOT_FOUND`/`ENGINE_BUSY` documented.
- [X] T005 [P] Create `tests/store/tree.test.ts`: pathOf/siblings/deepestLeaf/variantIndex on a hand-built tree; backfill correctness for a legacy linear conversation.
- [X] T006 `src/bun/rpc/handlers.ts`: `chat.send` chains new messages on `activeLeaf` (parent = leaf); `streamAssistant` history built from `pathOf` not array slice; `findMessage`/`turnsBefore` updated to tree semantics.

## Phase 2: US1 — Regenerate keeps alternate answers (P1)

**Goal**: regenerating stores a sibling variant; per-message ‹ n/m ›
navigation switches the displayed subtree.

**Independent Test**: regenerate twice → 3 variants reachable, send
continues from the displayed one (VS-1).

- [X] T007 [US1] Create `tests/rpc/branch.test.ts`: regenerate creates sibling (original untouched — content, status, stats, phases intact per FR-009; fusion sibling keeps its own `phases.plan` per FR-008), `activeLeaf` advances to newest variant, `message.selectVariant` round-trips and returns `activeLeaf`, selectVariant during generation → `ENGINE_BUSY`, regenerate on non-last message → `NOT_FOUND`, regenerate of a partial/failed answer also creates a sibling (edge case).
- [X] T008 [US1] `src/bun/rpc/handlers.ts`: `chat.regenerate` creates a NEW assistant sibling (same `parentId`, fresh id, `status:"generating"`), sets `activeLeaf` to it, streams via `streamAssistant` — remove in-place content reset.
- [X] T009 [US1] `src/bun/rpc/handlers.ts`: implement `message.selectVariant` — `activeLeaf = deepestLeaf(target)`; `NOT_FOUND` if msg/conv missing; `ENGINE_BUSY` while generating; persist.
- [X] T010 [US1] `src/renderer/src/features/chat/use-chat.ts`: hydrate stores flat messages + `activeLeaf`; client-side `pathOf`/`siblings` helpers (mirror of tree.ts); reducer derives displayed path; `selectVariant` callback → invoke + local update; block while `generatingId`.
- [X] T011 [US1] Create `src/renderer/src/features/chat/VariantNav.tsx` (‹ n/m › prev/next buttons, hidden when total=1, disabled while generating) and wire into `MessageList.tsx` — picker on every message with siblings, displayed message follows selection.

## Phase 3: US2 — Edit creates a branch (P2)

**Goal**: editing a user message creates a sibling variant + fresh
answer; original subtree stays reachable (VS-2).

**Independent Test**: edit mid-conversation → user message shows 2
variants; switching restores the original sub-tree.

- [X] T012 [US2] Extend `tests/rpc/branch.test.ts`: `chat.edit` produces a user sibling (original message preserved verbatim — content/status/timestamps/stats per FR-009), new assistant child with `parentId` = new user msg, `activeLeaf` on the new leaf; switching the user variant swaps the whole displayed subtree incl. original descendants.
- [X] T013 [US2] `src/bun/rpc/handlers.ts`: `chat.edit` — create user sibling (edited text, same `parentId` as target) + new assistant child; DO NOT splice/delete tail (`deleteMessagesAfter` is no longer on the edit path — keep export for existing tests/cleanup); set `activeLeaf` to new assistant id; history = `pathOf` up to the new user msg.
- [X] T014 [US2] `src/renderer/src/features/chat/use-chat.ts` + `MessageList.tsx`: `editApplied` reducer appends user variant + new assistant leaf instead of truncating; edit affordance stays on the displayed variant; whole-subtree swap on variant switch verified in UI state.
- [X] T015 [US2] Adapt `tests/rpc/chat.test.ts`: update edit/regenerate expectations to sibling semantics (original preserved, `activeLeaf` moved); keep all non-branch assertions green.

## Phase 4: US3 — Branch overview navigation (P3)

**Goal**: a surface listing branch points (≥2 variants) with previews;
click navigates (VS-3).

**Independent Test**: ≥2 branch points exist → overview lists them with
variant counts + previews; click selects that variant.

- [X] T016 [US3] Create `src/renderer/src/features/chat/BranchOverview.tsx`: list of branch points (sibling count, preview snippet per variant, active marker); click → `selectVariant`; open via toolbar button in `ChatPage.tsx` near RolesPanel/controls.
- [X] T017 [US3] `use-chat.ts`: expose `branchPoints` derived list (parentId → children where children.length > 1) for the overview.

## Phase 5: Polish & Cross-Cutting

- [X] T018 Validation: legacy-conversation backfill verified end-to-end (VS-4 step 3); VS-1…VS-3 walkthrough results + a measured variant-switch timing on a 1k-message fixture (SC-002 <100 ms target) written to `specs/005-conversation-branching/validation.md`.
- [X] T019 Gates + docs: `bun run typecheck`, `bun run lint`, `bun test ./tests`, `bun run build:renderer`, `bun run build:native` all green; update `AGENTS.md` (tree.ts module, parentId/activeLeaf, selectVariant contract, sibling-semantics note for edit/regenerate).

## Dependencies

```text
Phase 1 (T001–T006) → all story phases
US1 (Phase 2) — needs Phase 1 — MVP
US2 (Phase 3) — needs Phase 1 + T008/T009 patterns; independently testable
US3 (Phase 4) — needs T010/T011 (selectVariant + reducer)
Phase 5 — needs US1–US3
```

## Parallel Opportunities

- **Phase 1**: T005 (test file) ∥ T002/T003 (impl files) — test can be
  authored from the contract while impl lands.
- **Phase 2**: T010/T011 (renderer) ∥ T008/T009 (handlers) after T004.
- **Phase 3**: T014 (renderer) ∥ T013 (handler) after T012 defines
  expectations.

## Implementation Strategy

**MVP = Phase 1 + US1** (T001–T011): regenerate-variants + navigation is
the headline behavior — shippable alone.
**Then US2** (edit branching) — same mechanics applied to a second
entry point.
**Then US3** (overview) — pure UI sugar over existing state.
Commit per task or per logical group via
`.specify/extensions/git/scripts/bash/auto-commit.sh <phase> --message-file <f>`.
