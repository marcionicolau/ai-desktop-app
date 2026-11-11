---
description: "Task list for Desktop AI Chat feature implementation"
---

# Tasks: Desktop AI Chat

**Input**: Design documents from `/specs/001-desktop-ai-chat/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — constitution mandates FFI boundary tests and quickstart.md
defines automated checks (typecheck, FFI lifecycle, vite build).

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story label (US1, US2, US3) — story phases only

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure per plan.md

- [x] T001 Initialize Bun project: `package.json` with scripts (`dev`, `build:renderer`, `build:native`, `typecheck`, `test`), and dependencies `electrobun`, `vite`, `react`, `react-dom`, `typescript`, `tailwindcss@4`, `@tailwindcss/vite`, `oxlint` in `package.json`
- [x] T002 Create strict `tsconfig.json` (`strict: true`, `noUncheckedIndexedAccess`, JSX for React) covering `src/` at repo root
- [x] T003 [P] Scaffold Electrobun config `electrobun.config.ts`: `build.bun.entrypoint = "src/bun/index.ts"`, `build.copy` mapping `dist/renderer/` → `views/main/` and `native/out/<platform>/` → `native/<platform>/`
- [x] T004 [P] Create `hutch.config.ts` with `dev`/`build:canary`/`build:stable` script entries
- [x] T005 [P] Scaffold Vite renderer: `src/renderer/index.html`, `src/renderer/vite.config.ts` (React plugin + `@tailwindcss/vite`, `outDir: ../../dist/renderer`), `src/renderer/src/main.tsx`
- [x] T006 [P] Initialize Tailwind CSS v4 (CSS-first `@theme` in `src/renderer/src/index.css`, no `tailwind.config.js`) and shadcn/ui under `src/renderer/src/components/ui/`
- [x] T007 Add llama.cpp as git submodule pinned to a release tag at `src/native/vendor/llama.cpp/`
- [x] T008 Create `.gitignore` entries for `dist/`, `native/out/`, `artifacts/`, `node_modules/` at repo root

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Contract layer, FFI surface, and persistence that ALL stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T009 [P] Define shared domain types in `src/shared/types.ts`: `Conversation {id, title, createdAt, updatedAt, messages}`, `Message {id, conversationId, role: "user"|"assistant", content, status: "generating"|"complete"|"partial"|"failed", createdAt, completedAt}`, `ModelStatus: "unloaded"|"loading"|"ready"|"error"`
- [x] T010 [P] Define RPC contract in `src/shared/rpc-contract.ts` per `contracts/rpc.md`: request methods `model.load/unload/status`, `chat.send/stop`, `conversation.list/get/create/rename/delete`; events `chat.token`, `chat.done`, `chat.error`, `model.progress`; error codes `MODEL_NOT_FOUND`, `MODEL_INVALID`, `OUT_OF_MEMORY`, `ENGINE_ERROR`, `NO_MODEL`, `ENGINE_BUSY`, `EMPTY_MESSAGE`, `NOT_GENERATING`, `NOT_FOUND`, `EMPTY_TITLE`
- [x] T011 Write C shim header `src/native/shim/llama_shim.h` and implementation `src/native/shim/llama_shim.c` exposing the 8 symbols from `contracts/ffi.md` (`lls_version`, `lls_model_load`, `lls_model_free`, `lls_ctx_create`, `lls_ctx_free`, `lls_generate_begin`, `lls_step`, `lls_generate_end`, `lls_free_string`) with the ownership rules: `char** err` out-params freed via `lls_free_string`; `lls_step` writes ≤ `cap` bytes into a caller-allocated `buf` per call; single-threaded pull model — all calls on the JS thread, no C worker threads, no `JSCallback`
- [x] T012 [P] Write `src/native/shim/CMakeLists.txt`: `llama_shim` SHARED target linking `llama`; configure vendored llama.cpp with `BUILD_SHARED_LIBS=ON`, `LLAMA_BUILD_SERVER=OFF`, `LLAMA_BUILD_TOOLS=OFF`, `LLAMA_BUILD_TESTS=OFF`; set `@rpath` install names on macOS
- [x] T013 [P] Write `scripts/build-native.sh` (Linux/macOS: `cmake -B native/out/<platform>` + `cmake --build`) and `scripts/build-native.ps1` (Windows MSVC/clang-cl); plus `scripts/stage-native.ts` to copy `llama_shim` + `llama`/`ggml` artifacts into `native/out/<platform>/`
- [x] T014 Implement FFI loader in `src/bun/llama/ffi.ts`: `dlopen()` of `libllama_shim.${suffix}` resolved from `native/out/<platform>/` (dev) or `Resources/app/native/<platform>/` (packaged); declare all 8 symbols with plain-C `FFIType`s per `contracts/ffi.md`
- [x] T015 Implement typed engine wrapper in `src/bun/llama/engine.ts`: `loadModel(path)`, `dispose()`, `generate(prompt, onToken)` driving an async `lls_step` loop (emit token, yield to event loop each iteration, honor stop flag), `stop()`; enforce shutdown order `generate_end → ctx_free → model_free → close()`; validate all `char** err` out-params and convert nonzero returns to typed errors; guard every `CString`/ptr read against NULL (research.md D5)
- [x] T016 Implement JSON persistence in `src/bun/store/json-store.ts` + `src/bun/store/paths.ts`: atomic write of conversations and settings (`activeModelPath`) under `Utils.paths.userData`
- [x] T017 Bootstrap main process in `src/bun/index.ts`: create `BrowserWindow` loading `views://main/index.html` (packaged) or Vite dev-server URL (dev), register RPC handlers stub in `src/bun/rpc/handlers.ts`

**Checkpoint**: `bun run typecheck` passes; `scripts/build-native.sh` produces `libllama_shim.*` + deps; engine loads/unloads a real model without crash — story work can begin

---

## Phase 3: User Story 1 - Real-Time AI Conversation (Priority: P1) 🎯 MVP

**Goal**: Send a message, watch the response stream in token-by-token, and stop it mid-generation.

**Independent Test**: Load a model (via settings `activeModelPath` or env override), send a prompt, verify incremental rendering, then send again and stop mid-stream — partial text remains (quickstart VS-1).

### Tests for User Story 1

- [x] T018 [P] [US1] FFI lifecycle integration test in `tests/ffi/lifecycle.test.ts`: load model → `generate_begin` → `lls_step` N tokens → `generate_end` → `ctx_free` → `model_free` → `close()` → reload succeeds (ownership rules from `contracts/ffi.md`)
- [x] T019 [P] [US1] RPC contract test in `tests/rpc/chat.test.ts`: `chat.send` emits ordered `chat.token` deltas then `chat.done`; `chat.send` during generation rejects `ENGINE_BUSY`; `chat.stop` → `chat.done {status:"partial"}` within 1s (SC-006); empty/whitespace message rejects `EMPTY_MESSAGE`

### Implementation for User Story 1

- [x] T020 [US1] Implement `model.load`/`model.status` RPC handlers in `src/bun/rpc/handlers.ts` as thin pass-throughs to `engine.loadModel` with `model.progress` event emission (`loading → ready | error`); plus startup bootstrap: on app start, attempt `model.load` with `settings.activeModelPath` or `MODEL_PATH` env var if present (MVP path to a loaded model before US3's picker)
- [x] T021 [US1] Implement `chat.send` in `src/bun/rpc/handlers.ts`: create user `Message` (reject non-empty after trim per edge case), create assistant `Message {status:"generating"}`, drive `engine.generate` step loop → emit `chat.token {messageId, delta}` per chunk, emit `chat.done {status:"complete"}` at end or `chat.error` on failure; reject concurrent send with `ENGINE_BUSY` (FR-012)
- [x] T022 [US1] Implement `chat.stop` in `src/bun/rpc/handlers.ts`: sets the stop flag consumed by the `engine.generate` step loop (which calls `lls_generate_end` and returns), finalizes the in-flight message as `status:"partial"` (FR-003)
- [x] T023 [P] [US1] Build typed RPC client in `src/renderer/src/lib/rpc.ts` importing `src/shared/rpc-contract.ts` (invoke + subscribe APIs only — no raw bridge calls elsewhere)
- [x] T024 [P] [US1] Build chat UI in `src/renderer/src/features/chat/`: `MessageList` (renders `Message[]` with role styling via shadcn components), `Composer` (input + send/stop button), stream reducer accumulating `chat.token` deltas
- [x] T025 [US1] Wire composer states in `src/renderer/src/features/chat/`: send disabled with visible explanation while generating (FR-012), generating indicator shown (FR-010), stop button halts and keeps partial text
- [x] T026 [US1] Render model-not-loaded state in `src/renderer/src/features/chat/`: when `model.status` ≠ `ready`, show "load a model" prompt instead of silent failure (US1 acceptance 3)

**Checkpoint**: US1 works end-to-end offline — send → streamed tokens → complete; send → stop → partial preserved

---

## Phase 4: User Story 2 - Persistent Conversation History (Priority: P2)

**Goal**: Multiple named conversations, switching, deletion, and full restore across restarts — including partial messages after a crash.

**Independent Test**: Two conversations with distinct messages → full quit → relaunch → both restored exactly; delete one → gone after another relaunch (quickstart VS-2).

### Tests for User Story 2

- [x] T027 [P] [US2] Store test in `tests/store/json-store.test.ts`: write → read round-trip preserves message order and `status` fields; atomic write leaves no torn file on simulated failure
- [x] T028 [P] [US2] RPC test in `tests/rpc/conversations.test.ts`: `conversation.create/list/get/rename/delete` behaviors and error codes `NOT_FOUND`, `EMPTY_TITLE` per `contracts/rpc.md`

### Implementation for User Story 2

- [x] T029 [US2] Implement `conversation.*` RPC handlers in `src/bun/rpc/handlers.ts` on `json-store.ts`: `Conversation {id, title, createdAt, updatedAt, messages}`; title defaults to first user message (truncated), non-empty enforced on rename (`EMPTY_TITLE`); `updatedAt` bumps on every message append (data-model.md rules)
- [x] T030 [US2] Auto-save message appends in `src/bun/rpc/handlers.ts`: every user send, a token-flush checkpoint on a ~500ms timer during generation, and `chat.done`/`chat.error` writes through `json-store.ts`; in-flight (`generating`) assistant messages persist as `status:"partial"` on unexpected exit (SC-004)
- [x] T031 [P] [US2] Build conversation sidebar in `src/renderer/src/features/chat/`: list via `conversation.list`, active highlight, new-conversation button, inline rename, delete with confirmation dialog (shadcn `AlertDialog`)
- [x] T032 [US2] Wire conversation switching in `src/renderer/src/features/chat/`: `conversation.get` loads full history into `MessageList`; first send auto-creates conversation (US2 acceptance 3)

**Checkpoint**: US1 + US2 both work — conversations survive restart including partial responses

---

## Phase 5: User Story 3 - Local Model Management (Priority: P3)

**Goal**: Pick a local model file in the UI, watch load progress, see readable errors, and switch models without losing history.

**Independent Test**: Valid file → `ready`; corrupt file → readable error, app stable, prior state preserved (quickstart VS-3).

### Tests for User Story 3

- [x] T033 [P] [US3] Model RPC test in `tests/rpc/model.test.ts`: `model.load` on missing path → `MODEL_NOT_FOUND`; corrupt file → `MODEL_INVALID`; `model.progress` emits `loading → ready`; `model.unload` then `chat.send` → `NO_MODEL`
- [x] T034 [P] [US3] Engine error-path test in `tests/ffi/errors.test.ts`: `lls_model_load` failure returns NULL + `err` string; wrapper frees via `lls_free_string` and surfaces typed error

### Implementation for User Story 3

- [x] T035 [US3] Extend `model.load` from T020 with file validation + add `model.unload` in `src/bun/rpc/handlers.ts` (depends on T020): path exists/readable check, error mapping to `MODEL_NOT_FOUND`/`MODEL_INVALID`/`OUT_OF_MEMORY`/`ENGINE_ERROR` with human-readable `err` strings (FR-007); switching unloads previous model first (`ready → loading`, data-model.md)
- [x] T036 [US3] Persist `activeModelPath` in settings via `src/bun/store/json-store.ts` (persisted on load, bootstrap-loads on launch — data-model.md)
- [x] T037 [P] [US3] Build model picker UI in `src/renderer/src/features/models/`: file browse control (native dialog via Electrobun), current model name + status badge, progress indicator driven by `model.progress` events
- [x] T038 [US3] Render load-error state in `src/renderer/src/features/models/`: show `model.progress {phase:"error", detail}` message, keep chat input disabled until `ready`, preserve prior working model state (US3 acceptance 2)

**Checkpoint**: All three stories independently functional — model managed in UI, chat streams, history persists

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Edge cases, quality gates, and release validation

- [x] T039 Implement context-limit warning in `src/bun/rpc/handlers.ts`: when conversation token estimate approaches model context limit, warn user and apply oldest-turn truncation (FR-011, documented assumption)
- [x] T040 [P] Wire `oxlint` config and verify gates: `bun run typecheck` (strict), `bun test`, `vite build` all pass (constitution quality gates)
- [ ] T041 [P] Verify `scripts/build-native.ps1` on Windows produces `llama_shim.dll` + deps and `build.copy` stages them correctly
- [ ] T042 [P] Verify macOS build produces `*.dylib` set with `@rpath` names resolving inside `Resources/app/native/` in the packaged bundle
- [x] T043 Run full `quickstart.md` validation (VS-1 through VS-4) offline and record results
- [x] T044 Package canary build (`bun electrobun build --env=canary`) and smoke-test installer artifact per OS runner available

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on T001–T008; BLOCKS all stories
- **US1/US2/US3 (Phases 3–5)**: Depend on Foundational; sequential P1 → P2 → P3 recommended (shared `handlers.ts` file)
- **Polish (Phase 6)**: Depends on completed stories

### User Story Dependencies

- **US1 (P1)**: Foundational only — no story dependencies
- **US2 (P2)**: Foundational + uses `handlers.ts`/`json-store.ts` from Foundational; independently testable
- **US3 (P3)**: Foundational + `model.*` handlers introduced in US1; independently testable

### Within Each User Story

- Tests first (T018–T019, T027–T028, T033–T034), implementation after
- Shared files (`handlers.ts`) serialize tasks within a phase

### Parallel Opportunities

- Phase 1: T003–T006 parallel (independent config/scaffold files)
- Phase 2: T009+T010, T012+T013 parallel; T011 blocks T014/T015
- Per story: test tasks [P] pairwise; renderer UI tasks [P] vs bun handlers
- Phase 6: T040–T042 parallel

---

## Parallel Example: User Story 1

```bash
# Launch US1 tests together:
Task: "FFI lifecycle integration test in tests/ffi/lifecycle.test.ts"
Task: "RPC contract test in tests/rpc/chat.test.ts"

# Then parallel renderer/main tracks:
Task: "Typed RPC client in src/renderer/src/lib/rpc.ts"
Task: "chat.send handler in src/bun/rpc/handlers.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup → Phase 2 Foundational (native libs build + FFI lifecycle green)
2. Phase 3 US1 → validate with quickstart VS-1 → demo-able MVP (streams chat, stops, offline)

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. + US1 → MVP demo
3. + US2 → persistence demo
4. + US3 → full feature → package canary per OS
