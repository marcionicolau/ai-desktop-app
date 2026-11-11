# Tasks: Personas & Prompt Presets

**Input**: Design documents from `/specs/006-personas-prompt-presets/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/rpc.md

## Format: `[ID] [P?] [Story] Description`

## Phase 1 — Foundational

- [ ] T001 Add shared types `Persona` (`{name, systemPrompt, params:
  Partial<GenerationParams> | null, preferredTag?}`), `Snippet`
  (`{name, text}`), `Settings.personas: Persona[]`, `Settings.snippets:
  Snippet[]`, `Conversation.personaName?: string | null`,
  `ConversationSummary.personaName?` in `src/shared/types.ts`.
- [ ] T002 Add contract requests `persona.list/upsert/delete/usage`,
  `snippet.list/upsert/delete`, `conversation.setPersona` (→
  `{suggestedTag?}`) in `src/shared/rpc-contract.ts`.
- [ ] T003 Create `src/bun/personas/seed.ts` (concise/tutor/coder
  starters) + `src/bun/personas/service.ts`: `PersonaService` with
  injectable `{store}` dep (same pattern as `RolesService`) — seed-on-
  read, `list/upsert/delete/usage` for personas, `list/upsert/delete`
  for snippets; validation per D5: name `SLUG_RE` + unique,
  systemPrompt non-empty + ≤8 KiB, params via `validateParams`,
  preferredTag must name an existing tag, snippet names unique across
  snippets AND personas. Errors: `INVALID_PARAMS` / `NOT_FOUND`.
- [ ] T004 Extend `src/bun/llama/prompt.ts`: `PromptTurn.role` gains
  `"system"`; `buildPrompt` `opts.system?: string` prepends an
  always-kept system turn whose cost is charged first (hard-truncate
  if it alone exceeds budget, flag `truncated`); `render` handles
  `system` in both ChatML and plain formats.
- [ ] T005 [P] Add `tests/personas/service.test.ts`: seed-on-read;
  upsert validation (slug/empty/oversized/params/tag); uniqueness incl.
  snippet↔persona collision; delete clears `personaName` on fake
  conversations + `cleared` count; `usage` titles.
- [ ] T006 [P] Extend prompt tests (`tests/llama/` or adjacent): system
  turn always first + kept when history overflows; cost charged before
  history; hard-truncation flag; both render arms emit system.

## Phase 2 — US1 (P1): persona applied to a conversation

**Goal**: assign persona → every turn steered by its system prompt +
params; unassign → default.

**Independent Test**: `chat.send` on a persona-assigned conversation
produces a prompt containing the system turn and uses persona params.

- [ ] T007 [US1] Cascade wiring: `RolesService.resolveCandidates(name,
  {personaParams?})` inserts persona between `settings.generation` and
  `modelOverrides` in `src/bun/models/roles.ts`; same middle layer in
  `resolveGenParams` (`src/bun/rpc/handlers.ts`); `runFusionTurn` gets
  `system?: string` + `personaParams?` applied to executor candidates
  only — planner untouched (FR-009) in `src/bun/llama/fusion.ts`.
- [ ] T008 [US1] Wire handlers in `src/bun/rpc/handlers.ts`: resolve
  `conv.personaName` via `deps.personas` (optional dep like `roles` —
  absent = no persona) in `chat.send`/`regenerate`/`edit`; pass
  `system` + `personaParams` to `buildPrompt`/fusion; `chat.warning`
  `CONTEXT_TRUNCATED` also fires when the system turn truncates.
  Implement `conversation.setPersona` (`NOT_FOUND` on unknown conv or
  persona; returns `{suggestedTag?}` = persona.preferredTag when set
  and differing).
- [ ] T009 [US1] Add `tests/rpc/personas.test.ts`: send → prompt
  contains system turn + persona params merged at correct precedence;
  unassign → default behavior; two conversations keep separate
  personas; `setPersona` `suggestedTag`; missing persona → `NOT_FOUND`.
- [ ] T010 [US1] `src/renderer/src/features/chat/ChatPage.tsx`:
  persona select in the conversation header populated from
  `persona.list` → `conversation.setPersona`; visible badge for the
  active persona; `suggestedTag` surfaced as an inline offer (button →
  existing role/model RPC). Sidebar badge via
  `ConversationSummary.personaName` (FR-006).

## Phase 3 — US2 (P2): persona management

**Goal**: create/edit/duplicate/delete personas with validation +
starter set.

**Independent Test**: CRUD persists across a `persona.list` reload;
deleting an in-use persona names + clears affected conversations.

- [ ] T011 [US2] `src/renderer/src/features/personas/PersonasPanel.tsx`
  (settings surface, mirrors `RolesPanel`): list with name/systemPrompt/
  params editor + preferredTag select from `role.list`; create/edit/
  duplicate/delete flows; delete confirms via `persona.usage` naming
  affected conversations (D4).
- [ ] T012 [US2] Extend `tests/rpc/personas.test.ts`: upsert→list
  persistence; duplicate flow (copy under new slug); delete in-use →
  `cleared` count + conversations send without errors (SC-004);
  validation rejections (`INVALID_PARAMS`).

## Phase 4 — US3 (P3): snippet quick-insert

**Goal**: save fragments, insert via `/`-triggered picker.

**Independent Test**: `/` in the composer filters `snippet.list` and
inserts the fragment at the cursor.

- [ ] T013 [US3] `src/renderer/src/features/chat/Composer.tsx`: `/`
  opens a filtered picker (`snippet.list`, name-prefix match), arrow/
  Enter selects → insert `text` at cursor; dismiss on Escape/blur.
  Snippet CRUD lives in `PersonasPanel` (T011, shared "Snippets"
  section).
- [ ] T014 [US3] Extend `tests/rpc/personas.test.ts`: snippet
  upsert/list/delete round-trip; persona-name collision →
  `INVALID_PARAMS`.

## Phase 5 — Polish

- [ ] T015 Write `specs/006-personas-prompt-presets/validation.md`
  mapping quickstart VS-1…VS-3 to test evidence + gates.
- [ ] T016 Run all gates (`bun test`, typecheck, lint, build); append
  module notes to `AGENTS.md` (personas/ dir, settings-resident
  storage, cascade order, executor-only fusion rule).

## Dependencies

- T001–T006 foundational; T007+ need them.
- US1 (T007–T010) = MVP: assign → steered turns.
- US2 (T011–T012) independent of US1 code (service already done).
- US3 (T013–T014) needs T003 snippets + Composer only.
- T015/T016 last.

## Parallel Opportunities

- T005 ‖ T006 (separate test files).
- T011 ‖ T012 (UI ‖ tests).
- T013 ‖ T014 (UI ‖ tests).
