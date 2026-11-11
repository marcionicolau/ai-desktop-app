# Tasks: Sandboxed Local Tool Use

**Input**: Design documents from `/specs/015-local-tool-use/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/rpc.md, quickstart.md

**Tests**: included — constitution requires coverage at the RPC boundary and repo convention places behavior tests in `tests/`.

**Organization**: two user stories — US1 (P1, grounded reads mid-turn) and US2 (P2, visibility & policy). Foundation carries the shared types, parser, sandbox, and service both stories need.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no incomplete dependencies
- **[Story]**: US1/US2 per spec.md user stories

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: contract + type surface every later task compiles against

- [X] T001 Extend `src/shared/types.ts` with `ToolName = "read_file" | "list_dir"`, `ToolCallStatus` (`pending|approved|denied|refused|executed|error`), `ToolCallRecord` (id, tool, path, resolvedPath?, status, refuseReason?: `"out-of-sandbox"|"budget"|"malformed"|"disabled"`, error?, resultPreview? ≤200 chars single-line, resultBytes?, createdAt, decidedAt?), `ToolPolicy` (`sandboxRoot: string|null`, `mode: "ask"|"allow-read-session"|"deny"`), `AuditEntry` (per data-model.md); add `toolCalls?: ToolCallRecord[] | null` to `Message` and `tools?: ToolPolicy` to `Settings`
- [X] T002 Extend `src/shared/rpc-contract.ts`: bun requests `tool.respond` `{callId, decision: "approve"|"deny"|"allowSession"}` and `tool.pickRoot` → `{path: string|null}`; webview message `tool.update` `{messageId, call: ToolCallRecord}`; `"TOOL_BUDGET"` added to `chat.warning` code union; `tools` added to `settings.get` response and `settings.set` params per contracts/rpc.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: parser, sandbox, executors, policy service — required by both stories

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 [P] Create shared parser in `src/shared/tool-call.ts`: scan text for fenced ````tool_call` blocks → `{tool, path}` records + block spans for renderer splitting; enforce exactly one JSON object per block, `tool` ∈ `{"read_file","list_dir"}`, non-empty string `path`; malformed → typed `malformed` verdict (research D3)
- [X] T004 [P] Parser tests in `tests/tools/parser.test.ts`: valid block extraction, surrounding prose ignored, multiple blocks, malformed JSON, wrong tool name, missing/empty path, multiple objects in one block
- [X] T005 [P] Create `src/bun/tools/sandbox.ts`: canonicalize `sandboxRoot` via `realpathSync`; `resolve(path)` — relative joins root, absolute as-is — then `realpathSync` target and require `resolved === root || resolved.startsWith(root + sep)`; out-of-root → `refused`, nonexistent in-root target → tool error not refusal (research D4)
- [X] T006 [P] Create `src/bun/tools/executor.ts`: `read_file` (utf-8, binary guard) and `list_dir` (entry names + type) via node:fs; truncate result content at **8 KiB** appending `\n…[truncated]` marker (research D7)
- [X] T007 [P] Create `src/bun/tools/audit.ts`: append one `AuditEntry` JSON line to `dataDir()/tool-audit.jsonl` per executed-or-errored call (research D10)
- [X] T008 Create `src/bun/tools/service.ts`: read `ToolPolicy` from settings; `active()` = `sandboxRoot` set AND `mode !== "deny"`; per-conversation in-memory session grants (`Map<conversationId, true>` — never persisted); pending-call deferral registry (`callId → resolve/reject`) consumed by `tool.respond`; discard-on-stop path (research D5/D9)
- [X] T009 Foundational tests in `tests/tools/sandbox.test.ts` + `tests/tools/executor.test.ts` + `tests/tools/service.test.ts`: `..` traversal refusal, symlink escape refusal, in-root file resolves, nonexistent-in-root → error verdict, 8 KiB truncation + marker, grant keyed per conversation and absent after restart, deny/unset-root → `active()` false
- [X] T010 Extend `src/bun/llama/prompt.ts` with the `tool_call` instruction block text and a `composeSystem(persona, toolsActive)` helper — instruction included only when tools are active (FR-012, research D9)

**Checkpoint**: foundation ready — parser/sandbox/executor/service all tested in isolation

---

## Phase 3: User Story 1 - Model reads an allowed file mid-turn (Priority: P1) 🎯 MVP

**Goal**: fenced `tool_call` → inline approval → sandboxed execution → `tool_result` injected → turn completes grounded in real file content; refusals and denials feed back gracefully

**Independent Test**: with sandbox root set + ask mode, prompt for file content; approve the card; the answer reflects the real file. Out-of-sandbox call refuses without prompting. (quickstart scenarios 1–3)

- [X] T011 [US1] Create the stop-and-continue driver in `src/bun/tools/loop.ts`: wraps a single generate call — detects a complete ````tool_call` block via the shared parser during `onToken`, calls `engine.stop()`, resolves the pending call through service deferral (approve → sandbox → execute → audit; deny/refuse → verdict result), appends a fenced ````tool_result` block to accumulated text, and re-issues `generate()` with `originalPrompt + generatedSoFar + result` relying on `lls_generate_continue` prefix reuse; per-turn budget counts all detected calls at **5**, then injects "tool budget exhausted", emits `TOOL_BUDGET`, and disarms parsing so later blocks are inert `refused/budget`; on ctx-overflow in a continuation prompt, shrink the injected `tool_result` content (halve, floor 1 KiB) then drop oldest `tool_result` blocks before failing the turn (research D1/D2/D6/D8)
- [X] T012 [US1] Loop tests in `tests/tools/loop.test.ts` with a fake engine: block detected → generate stops → approve → result injected → resume; deny → denial result fed back; cap at 5 + disarm; malformed block consumes a budget slot; discard on stop → `partial`
- [X] T013 [US1] Wire the loop into the single-mode generate site and add turn-level plumbing in `src/bun/rpc/handlers.ts`: emit `tool.update` on every status transition; `tool.respond` request resolves the service deferral (`NOT_FOUND` when not pending); send/regenerate/edit return `ENGINE_BUSY` while a turn is paused on approval (`activeMessageId` gate); `chat.stop` on a pending call discards it and ends `partial`; persist `toolCalls` on the assistant message
- [X] T014 [US1] RPC tests in `tests/rpc/tools.test.ts`: send → `tool.update` pending → respond approve → `executed` + completed answer; deny path; stop-while-pending → `partial`; `ENGINE_BUSY` during approval pause; out-of-sandbox → `refused` with no `tool.update pending`
- [X] T015 [P] [US1] Create `src/renderer/src/features/tools/ToolCallCard.tsx` + `use-tool-calls.ts`: card shows tool icon/name, path, verdict badge, result preview; `pending` renders Approve / Deny / Allow-session buttons calling `tool.respond`; subscribe to `tool.update` into a `callId`-keyed map
- [X] T016 [US1] Extend `src/renderer/src/features/chat/MessageList.tsx`: split `message.content` on `tool_call`/`tool_result` block spans (shared parser) → prose segments rendered normally + `<ToolCallCard>` at each block position, in emission order
- [X] T017 [US1] Inject the tool instruction into the single-mode prompt in `src/bun/rpc/handlers.ts`: `buildPrompt` `system` = `composeSystem(persona?.systemPrompt, toolsActive)` where `toolsActive` comes from the tool service (FR-012)

**Checkpoint**: US1 end-to-end — approved read grounds the answer; refusal/denial/stop paths all verified by tests + quickstart 1–3

---

## Phase 4: User Story 2 - Tool-call visibility & policy (Priority: P2)

**Goal**: sandbox root + approval mode configurable in settings; session-allow grant honored per conversation; deny-all preserves pre-feature behavior

**Independent Test**: allow-read-for-session → consecutive calls execute un-prompted, switching conversation re-prompts; deny-all → prompt byte-identical, calls refused (quickstart scenarios 4, 6)

- [X] T018 [US2] Extend `settings.get`/`settings.set` in `src/bun/rpc/handlers.ts`: `tools` passthrough with `ToolPolicy` default `{sandboxRoot: null, mode: "deny"}`; `sandboxRoot` must be an existing directory → `INVALID_PARAMS`; `mode` enum validated
- [X] T019 [US2] Implement `tool.pickRoot` in `src/bun/rpc/handlers.ts` via injected `dialogs.pickFolder` (attachments precedent — headless-testable), returning `{path: string|null}` where null = cancelled
- [X] T020 [P] [US2] Add a Tools section to `src/renderer/src/features/settings/GenerationSettings.tsx`: sandbox-root row (path + Pick button → `tool.pickRoot` → `settings.set`) and mode select (`ask` / `allow-read-session` / `deny`)
- [X] T021 [US2] Deny-invariance test in `tests/rpc/tools.test.ts` or `tests/tools/`: with `mode: "deny"` or unset root, `buildPrompt` output is byte-identical to pre-feature prompt; any emitted block is `refused` (`disabled`) with no prompt and no instruction injection (SC-004, FR-012)
- [X] T022 [US2] Session-grant tests in `tests/tools/service.test.ts` + `tests/rpc/tools.test.ts`: `allowSession` decision → subsequent read calls in that conversation execute without `pending`; grant keyed per conversation; no persistence write (in-memory only)

**Checkpoint**: both stories independently functional — policy toggles live in settings, grants behave per spec

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: fusion integration, audit/persistence verification, docs, gates

- [X] T023 Extend `src/bun/llama/fusion.ts`: pass the tool loop into the executor `genPhase` only — planner phase never receives it and its prompt never gets tool instructions (FR-009); add fusion RPC test asserting executor-only tool cards
- [X] T024 Persistence + audit tests in `tests/tools/` and `tests/store/`: `toolCalls` records survive conversation save/reload with verdicts; `tool-audit.jsonl` gains exactly one entry per executed/errored call containing tool/path/verdict (FR-011)
- [ ] T025 [P] Walk `specs/015-local-tool-use/quickstart.md` scenarios 1–8 against `hutch dev`; record outcomes; fix or file gaps found (doc updated to shipped UI labels; manual walk needs a GGUF model + `hutch dev`)
- [X] T026 [P] Add a Tools section to `AGENTS.md` documenting the `src/bun/tools/` module boundary, sandbox invariant, and deny-mode byte-identical guarantee
- [X] T027 Run full gates: `bun test`, `bun check` (tsc strict), lint, `vite build` — all green, no new deps, no FFI changes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — types/contract first so everything compiles
- **Foundational (Phase 2)**: depends on T001/T002 — parser, sandbox, executor, audit, service are parallel ([P] where file-disjoint) but all block stories
- **US1 (Phase 3)**: depends on Phase 2; T011→T012 loop core first, then T013/T017 wiring, T014/T016 can follow wiring
- **US2 (Phase 4)**: depends on T013 (`tool.respond` surface) — settings/grant work builds on the live call path
- **Polish (Phase 5)**: depends on US1+US2

### User Story Dependencies

- **US1 (P1)**: foundation only — standalone MVP
- **US2 (P2)**: shares service + respond path from US1 but is testable in isolation (settings/grant behavior)

### Parallel Opportunities

- Phase 2: T003/T004, T005, T006, T007 in parallel; T008 after T001 only
- Phase 3: T015 (renderer) ∥ T013/T014 (bun); T016 after T015
- Phase 4: T020 (renderer) ∥ T018/T019/T021/T022 (bun/tests)
- Phase 5: T025 ∥ T026

### Parallel Example: Phase 2

```bash
Task: "Create shared parser in src/shared/tool-call.ts"
Task: "Parser tests in tests/tools/parser.test.ts"
Task: "Create src/bun/tools/sandbox.ts"
Task: "Create src/bun/tools/executor.ts"
Task: "Create src/bun/tools/audit.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 types/contract → Phase 2 foundation (tested in isolation)
2. Phase 3: loop + wiring + card → **validated by quickstart 1–3**
3. Stop point: a fully working approved-read flow with refusal/denial/stop safety

### Incremental Delivery

1. Setup + Foundational → tool primitives verified headless
2. US1 → grounded reads mid-turn (MVP)
3. US2 → policy surface + grants + deny invariance
4. Polish → fusion executor-only, audit, docs, gates
