# Tasks: Tagged Model Roles & Planner–Executor Fusion

**Input**: Design documents from `specs/004-model-roles-fusion/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: included — constitution requires automated coverage at the
FFI/RPC boundary; each story gets a contract/unit suite.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on incomplete tasks)
- **[Story]**: US1 = tag bindings UI · US2 = fusion generation · US3 = fallbacks

---

## Phase 1: Setup (shared types & persistence)

- [x] T001 Extend `src/shared/types.ts`: `ModelTag` (`name` slug `/^[a-z0-9]+(-[a-z0-9]+)*$/` 1–32 chars, `label?`, `description?`, `binding: string|null`, `params: Partial<GenerationParams>`, `fallback: RoleRef[]`), `RoleRef` (`{kind:"tag";name}|{kind:"model";fileName}`), `RoleState` (`"bound"|"unbound"|"broken"`), `ResolvedRole`, `FusionPhase` (`"plan"|"answer"`), `PhaseStats`, `ModelSlot`-facing types; extend `Conversation` with `mode:"single"|"fusion"`, `plannerTag`, `executorTag`; extend `Message` with optional `phases`; extend `Settings` with `tags: ModelTag[]`.
- [x] T002 Extend `src/shared/rpc-contract.ts`: add `role.list/create/update/delete/bind/setFallback/resolve`, `conversation.setMode`, optional `tagName` on `model.download`, events `chat.phase` + `role.changed`, `phase?` on `chat.token`, per-phase `chat.done.stats`, error codes `ROLE_UNBOUND` + `ROLE_IN_USE` — per `contracts/rpc.md`.
- [x] T003 Extend `src/bun/store/json-store.ts`: settings schema gains `tags` (default `[]`, provision `default` bound to `activeModelPath`, plus unbound `planner`+`executor`, on first load; keep `default`↔`activeModelPath` synced both directions), conversation gains `mode`/`plannerTag`/`executorTag` defaults (`"single"`/`"planner"`/`"executor"`); validate on load; round-trip test additions in `tests/store/json-store.test.ts`.

## Phase 2: Foundational (blocking prerequisites)

- [x] T004 Implement `src/bun/models/roles.ts`: tag CRUD with slug + uniqueness validation, `bind(name, fileName|null)`, fallback chain setter (`≤3` entries, no self-ref, cycle-checked), `state(tag)` derivation (`bound`/`unbound`/`broken` via library scan), and `resolve(name) → ResolvedRole` — *static* resolution: walks binding → fallback chain in order (cycle-checked, `servedBy` recorded), throws `ROLE_UNBOUND`. Runtime-failure cascade (load/generate error → try next candidate) is T019's job, not this task's.
- [x] T005 Implement `src/bun/models/registry.ts`: `ModelRegistry` — `Map<normalizedPath, ModelSlot>`; `acquire(path)` shares slots (FR-011), `MAX_SLOTS=2` with LRU eviction of non-busy slots, `busyFor`/`stale` semantics per data-model, `release()`, `shutdown()` freeing ctx→model in order; wraps `LlamaEngine` per slot.
- [x] T006 Param cascade in `src/bun/llama/params.ts` or `roles.ts`: effective params = `DEFAULT_GENERATION ← settings.generation ← modelOverrides[file] ← tag.params` via existing `mergeParams`; applied inside `resolve` so `ResolvedRole.params` is final.
- [x] T007 Wire `role.*` + `role.changed` handlers in `src/bun/rpc/handlers.ts` (`createRequestHandlers` deps gain `roles`, `registry`); add `ROLE_UNBOUND`/`ROLE_IN_USE` to `fail()` usage; emit `role.changed` after every mutation; `model.load`/`role.bind("default")` keep `default`↔`activeModelPath` synced; single-mode `streamAssistant` resolves via `resolve("default")` instead of raw `activeModelPath` (FR-010). Update `src/bun/index.ts` to construct registry/roles.

## Phase 3: User Story 1 — Named Model Roles Bound to Real Models (P1)

**Goal**: full tag CRUD + bind + states in UI; download→bind flow; single-mode chat works through tags.
**Independent test**: VS-1 + VS-2 in quickstart.md — create/bind tag, restart persistence, broken-state display, download auto-bind.

- [ ] T008 [P] [US1] `tests/roles/roles.test.ts`: CRUD, slug rejection (`INVALID_PARAMS`), duplicate (`ALREADY_EXISTS`), state derivation, resolve/fallback walk, `ROLE_UNBOUND`.
- [ ] T009 [P] [US1] `tests/roles/registry.test.ts`: two acquires same path → one slot; `MAX_SLOTS=2` LRU eviction; busy slot never evicted; `stale` freed after release.
- [ ] T010 [P] [US1] `tests/rpc/role.test.ts`: all `role.*` methods' params/responses/error codes vs `contracts/rpc.md`; `role.changed` emission.
- [ ] T011 [US1] `src/renderer/src/features/roles/use-roles.ts`: hook wrapping `role.list/create/update/delete/bind/setFallback/resolve`, subscribes `role.changed`.
- [ ] T012 [US1] `src/renderer/src/features/roles/RolesPanel.tsx` + `TagEditor.tsx`: tag list with `bound|unbound|broken` badges + bound-model metadata, create/rename/delete (with `ROLE_IN_USE` consumer naming), bind/unbind via library-model select, per-tag params editor reusing `GenerationSettings`, fallback chain editor. Entry point from `ChatPage`/`Sidebar`; when two fusion-bound models' combined file sizes exceed a documented threshold, show a memory-pressure hint (spec Assumptions).
- [ ] T013 [US1] Download→bind: `model.download` handler accepts `tagName` (validated upfront → `NOT_FOUND`), binds post-`done`, emits `role.changed`; add tag select to `ModelLibrary.tsx` download form. `.part`/error paths never bind (FR-004).

## Phase 4: User Story 2 — Fusion Generation (P2)

**Goal**: conversation fusion mode — sequential planner→executor phases, visible plan, per-role params.
**Independent test**: VS-3 + VS-4 — two-phase stream with labeled plan block, warm KV, gating on unbound role, stop-at-boundary partial.

- [ ] T014 [P] [US2] `src/bun/llama/plan-prompt.ts`: `buildPlannerPrompt(userText)` (concise-plan template, no JSON schema) + `buildExecutorPrompt(userText, plan)` injecting `<plan>…</plan>` block; unit tests in `tests/llama/plan-prompt.test.ts`.
- [ ] T015 [US2] `src/bun/llama/fusion.ts`: `FusionOrchestrator` — `runFusionTurn` state machine `planning→answering→done|partial|failed`; resolves both roles via registry (shared slot if same path), per-phase `engine.generate` with `ResolvedRole.params`, plan captured to `Message.phases.plan`, stop honored mid-phase and at boundary; emits `chat.phase` transitions. Tests in `tests/llama/fusion.test.ts`.
- [ ] T016 [US2] `src/bun/rpc/handlers.ts`: `conversation.setMode` (validates both tags resolvable → `ROLE_UNBOUND` naming missing tag); `streamAssistant` fusion branch delegating to orchestrator; persist `Message.phases`; `chat.done.stats` per-phase shape. Tests in `tests/rpc/fusion.test.ts`.
- [ ] T017 [US2] `src/renderer/src/features/chat/FusionControls.tsx`: mode toggle (refuses + names missing tag via `ROLE_UNBOUND`), planner/executor tag pickers from `role.list`; integrate in `ChatPage.tsx`.
- [ ] T018 [US2] `use-chat.ts` + `MessageList.tsx` + `ai-message.tsx`: route `chat.token` by `phase` into plan buffer vs answer buffer; collapsible Plan block labeled with planner tag/model; per-phase stats display.

## Phase 5: User Story 3 — Role Fallbacks & Per-Role Behavior (P3)

**Goal**: ordered fallback chains serve turns when primary fails; servedBy visible.
**Independent test**: VS-5 — primary file deleted → fallback serves + notice; both gone → typed error naming chain.

- [ ] T019 [US3] Runtime fallback cascade in `roles.ts`/`registry.ts`: on primary *load failure* or missing file at generation time (T004's static walk only orders candidates), retry subsequent `RoleRef[]` entries (tag → nested resolve, model → direct), depth-cap 3, record `servedBy`; surface in `chat.phase` (`servedBy:"fallback"`) and `role.resolve` response. Extend `tests/roles/roles.test.ts` + `tests/rpc/fusion.test.ts`.
- [ ] T020 [US3] UI: fallback notice in chat (which model served which tag) in `MessageList.tsx`/banner; fallback chain editor already in `TagEditor.tsx` from T012 — wire `role.setFallback` + `INVALID_PARAMS` display.

## Phase 6: Polish & Cross-Cutting

- [ ] T021 Shared-slot memory verification (VS-6): planner+executor on same file → registry exposes 1 slot; document in `validation.md`.
- [ ] T022 Live validation pass per `quickstart.md` VS-1…VS-6 → write `validation.md` with measured results (bind persistence, two-phase stream, fallback service, shared-slot memory).
- [ ] T023 Gates: `bun run typecheck`, `bun run lint`, `bun test ./tests`, `bun run build:renderer`, `bun run build:native` — zero errors/warnings; update `AGENTS.md` (roles/registry/fusion module map, role.* contract, MAX_SLOTS=2 policy).

---

## Dependencies

```text
Phase 1 (T001–T003) → Phase 2 (T004–T007) → all story phases
US1 (Phase 3)  — needs Phase 2 only — MVP
US2 (Phase 4)  — needs Phase 2 + T003 (conversation fields); benefits from US1 UI but independently testable via RPC
US3 (Phase 5)  — needs T004 resolve walk; extends US1/US2 surfaces
Phase 6        — needs US1–US3
```

## Parallel Opportunities

- **Phase 1**: T001, T002, T003 — different files, but T002 imports types from T001 (sequence T001 → T002/T003).
- **Phase 3**: T008, T009, T010 — three independent test files [P]; T011 vs T012/T013 partially parallel.
- **Phase 4**: T014 (prompt builders) ∥ T015 prep work; T017 UI ∥ T016 backend.
- **Phase 5**: T019 backend ∥ T020 UI after T012.

## Implementation Strategy

**MVP = Phase 1 + 2 + US1** (T001–T013): tagged bindings working in UI +
single-mode chat through tags is a shippable increment.
**Then US2** (fusion pipeline — the headline feature).
**Then US3** (fallback resilience).
Commit per task or per logical group via
`.specify/extensions/git/scripts/bash/auto-commit.sh <phase> --message-file <f>`.
