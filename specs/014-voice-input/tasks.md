# Tasks: Local Voice Input

**Input**: Design documents from `/specs/014-voice-input/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ffi.md, contracts/rpc.md, quickstart.md

**Tests**: included — constitution requires automated coverage at the FFI/RPC boundary and repo convention places behavior tests under `tests/` (scoped: `bun test ./tests`).

**Organization**: two user stories — US1 (P1, dictate a message) and US2 (P2, device & model management). Foundation carries the vendored engine, shim, worker, service, shared audio helpers, and RPC surface both stories need.

> **Rebase note**: this branch predates features 005–021. Paths below
> follow `origin/main` layout — rebase onto `main` before implementing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no incomplete dependencies
- **[Story]**: US1/US2 per spec.md user stories

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: vendored engine + contract/type surface every later task compiles against

- [ ] T001 Vendor a pinned whisper.cpp release into `src/native/vendor/whisper.cpp` (mirrors how `src/native/vendor/llama.cpp` is vendored); record the release/commit in the spec dir or vendoring note
- [ ] T002 Extend `src/native/shim/CMakeLists.txt`: `add_subdirectory` whisper.cpp with `WHISPER_BUILD_TESTS/EXAMPLES/SERVER` OFF + `BUILD_SHARED_LIBS ON`, add `whisper_shim` SHARED target linking `whisper` + `ggml`, and apply the same `$ORIGIN`/`@loader_path` rpath block used for llama targets (verify `bun run build:native` produces `libwhisper_shim.*`)
- [ ] T003 [P] Create `src/native/shim/whisper_shim.h` with the full `lws_*` ABI from contracts/ffi.md (`lws_version`, `lws_model_load/free`, `lws_ctx_create/free`, `lws_stt_params`, `lws_transcribe`, `lws_free_string`)
- [ ] T004 [P] Extend `src/shared/types.ts` with `SpeechModel` (`path`, `fileName`, `sizeBytes`, `format: "gguf"|"bin"`, `name: string|null`), `VoiceSettings` (`modelPath: string|null`, `deviceId: string|null`), `VoiceStatus` union (`idle`/`loading`/`transcribing` per data-model.md), and `VoiceTranscript`; add `voice?: VoiceSettings` to `Settings`
- [ ] T005 [P] Extend `src/shared/rpc-contract.ts` per contracts/rpc.md: bun requests `voice.list`, `voice.download`, `voice.select`, `voice.transcribe`; webview messages `voice.status`, `voice.download`; `voice` in `settings.get` response + `settings.set` params; add `"VOICE_BUSY"` and `"VOICE_UNAVAILABLE"` to `RPC_ERROR_CODES`
- [ ] T006 [P] Create `src/shared/audio.ts`: `VOICE_MAX_SECONDS = 60`, `SAMPLE_RATE = 16000`, base64↔`Uint8Array` and s16le↔f32 helpers, `maxPcmBytes` bound — shared by bun validation and renderer encoding

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: shim implementation, worker, and SpeechService — required by both stories

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T007 Implement `src/native/shim/whisper_shim.c` per contracts/ffi.md: `lws_ctx_create` wraps whisper context init; `lws_transcribe` converts s16→f32 into a scratch buffer, runs `whisper_full` (params from `lws_stt_params`, `language` NULL/""=auto), concatenates `whisper_full_get_segment_text` over `whisper_full_n_segments` into a shim-allocated `char*` (`""` for silence, never an error); NULL-safe frees
- [ ] T008 Create `src/bun/stt/ffi.ts`: `loadWhisperShim()` mirroring `loadLlamaShim` path resolution (`native/out/<platform>` dev, `Resources/app/native/<platform>` packaged) with typed `FFIType` symbols for the `lws_*` surface
- [ ] T009 Create `src/bun/stt/worker.ts`: Bun Worker entry that owns `loadWhisperShim()` + model/ctx handles; protocol = `{kind:"load",path}` / `{kind:"transcribe",pcm:ArrayBuffer}` requests → `{kind:"ok",text}` / `{kind:"error",code,message}` responses; frees prior model on re-load and on worker close
- [ ] T010 Create `src/bun/stt/service.ts` `SpeechService`: spawns/caches the worker, lazy model load on first transcribe, single-flight guard (second call → `VOICE_BUSY`), emits `voice.status` `loading`/`transcribing`, `scanSpeechModels()` over `modelsDir()/speech/` (`*.gguf|*.bin`, skip `.part`), `select(path)` containment check under the speech dir, `download` writer mirroring `model.download` (HF allowlist `…/resolve/<rev>/<file>.(gguf|bin)`, `.part`→rename, ≥4 MiB-throttled progress events); injectable worker factory for tests
- [ ] T011 Foundational tests in `tests/stt/service.test.ts` + `tests/shared/audio.test.ts`: s16/base64 round-trip, `VOICE_MAX_SECONDS` bound, single-flight `VOICE_BUSY`, lazy-load → `loading` status, select rejects paths outside `speech/` (`MODEL_NOT_FOUND`), silent-audio `""` passthrough, `VOICE_UNAVAILABLE` path when service absent
- [ ] T012 Extend `src/bun/store/json-store.ts` `Settings` with `voice` seeded `{modelPath: null, deviceId: null}` on read (absent → seeded, never migrated destructively)

**Checkpoint**: engine path fully functional main-side — `SpeechService.transcribe(pcm)` round-trips against a real or fake shim; foundation ready for both stories

---

## Phase 3: User Story 1 - Dictate a message (Priority: P1) 🎯 MVP

**Goal**: hold/toggle the mic, speak, get an offline transcript inserted into the composer draft

**Independent Test**: record a spoken sentence → transcript appears in the composer, editable, not sent (spec.md US1 acceptance 1–3)

### Tests for User Story 1

- [ ] T013 [P] [US1] RPC handler tests in `tests/rpc/voice.test.ts`: `voice.transcribe` valid payload → `{text, durationMs, modelFile}`; bad base64/`sampleRate`/`channels`/oversize → `INVALID_PARAMS`; unbound model → `NO_MODEL`; `deps.speech` absent → `VOICE_UNAVAILABLE`

### Implementation for User Story 1

- [ ] T014 [US1] Add `voice.transcribe` handler in `src/bun/rpc/handlers.ts`: validate payload against `src/shared/audio.ts` constants (`sampleRate: 16000`, `channels: 1`, decoded bytes ≤ `VOICE_MAX_SECONDS × 16000 × 2`), delegate to `deps.speech.transcribe`, map errors per contracts/rpc.md, wire `deps.emit("voice.status", …)` through `SpeechService`
- [ ] T015 [P] [US1] Create `src/renderer/src/features/voice/use-voice.ts`: `getUserMedia({audio:{deviceId, channelCount:1}})` + inline-Blob `AudioWorklet` capturing `Float32` frames into a buffer; `OfflineAudioContext` resample to 16 kHz mono on stop; encode s16le base64 via `src/shared/audio.ts`; expose `{state: idle|recording|busy, elapsedMs, start(), stop(), cancel(), error}`; `NotAllowedError`/`NotFoundError` → typed reason
- [ ] T016 [US1] Create `src/renderer/src/features/voice/VoiceButton.tsx`: mic toggle button (shadcn `Button`, `Mic`/`Square` icons), red-dot recording state with elapsed/`VOICE_MAX_SECONDS` countdown, auto-stop at cap, disabled + tooltip on `error`/no-permission, busy spinner during `voice.status` `loading`/`transcribing`
- [ ] T017 [US1] Wire `VoiceButton` + `use-voice` into the composer (`src/renderer/src/features/chat/` composer component): transcript from `voice.transcribe` inserts into the draft at cursor without sending (FR-002); mic stays usable while a generation streams (FR-007 — capture is renderer-local, transcription runs on the worker)
- [ ] T018 [US1] Route `voice.status` messages in the renderer RPC listener → `use-voice` busy state; transcript insertion clears `voice.status` to idle (FR-001 acceptance 2)

**Checkpoint**: US1 complete — dictate → edit → send works end-to-end offline; quickstart S1 passes

---

## Phase 4: User Story 2 - Device & model management (Priority: P2)

**Goal**: pick microphone + speech model; speech models managed in the model library flow, distinct from chat models

**Independent Test**: two input devices — selecting the second and recording uses it; switching speech model changes transcription (spec.md US2)

### Tests for User Story 2

- [ ] T019 [P] [US2] Handler + service tests in `tests/rpc/voice.test.ts` + `tests/stt/download.test.ts`: `voice.list` filters `.part` and tags `format`; `voice.select` persists `settings.voice.modelPath` + `MODEL_NOT_FOUND` on missing file; `voice.download` rejects non-allowlist URLs (`INVALID_URL`), `ALREADY_EXISTS`, writes to `models/speech/`, cleans `.part` on error; `settings.set` `{voice:{deviceId}}` merge round-trip

### Implementation for User Story 2

- [ ] T020 [US2] Add `voice.list`, `voice.select`, `voice.download` handlers in `src/bun/rpc/handlers.ts` per contracts/rpc.md (containment + allowlist rules delegated to `SpeechService`; `modelPath` writes accepted only via `voice.select`)
- [ ] T021 [US2] Extend `src/bun/rpc/handlers.ts` `settings.get`/`settings.set` for the `voice` delta (`deviceId` merge; ignore direct `modelPath` writes)
- [ ] T022 [P] [US2] Create `src/renderer/src/features/voice/SpeechModels.tsx`: Speech section inside `ModelLibrary` — list from `voice.list` (name/size/format), download form (URL + fileName) with `voice.download` progress events, select radio bound to `voice.select`, re-download notice when bound file is stale
- [ ] T023 [US2] Add device picker to voice settings UI: `enumerateDevices` audioinput `<select>` bound to `settings.voice.deviceId` via `settings.set`, falling back to default device when the stored id is gone; expose to `use-voice` `getUserMedia` constraint
- [ ] T024 [US1] In `VoiceButton`, when no speech model is bound (`settings.voice.modelPath === null`), activating voice input routes to the Speech library section instead of erroring (US1 acceptance 3)

**Checkpoint**: US1 + US2 both independently functional — quickstart S2 passes

---

## Phase 5: Polish & Cross-Cutting Concerns

- [ ] T025 [P] Update `AGENTS.md` module map with the 014 additions (`stt/`, `features/voice/`, `whisper_shim`, `voice.*` RPC)
- [ ] T026 Run all gates: `bun run typecheck`, `bun run lint`, `bun test ./tests`, `bun run build:renderer`, `bun run build:native`; verify `scripts/verify-artifact.sh` still passes on a canary build (new `libwhisper` libs ride the existing `native/out` copy rule)
- [ ] T027 Walk quickstart.md S1–S4 manual scenarios on the dev host (dictation, device switch, cap auto-stop, no-mic/denied, during-generation, silence, deleted model, offline)

---

## Dependencies & Execution Order

- **Phase 1 (Setup)**: T001→T002 ordered (vendor then build); T003–T006 parallel
- **Phase 2 (Foundational)**: T007 needs T002+T003; T008 needs T003; T009 needs T008; T010 needs T006+T008+T009+T012; T011 needs T010 — **blocks both stories**
- **Phase 3 (US1)**: T014 needs T010+T005; T015 needs T006; T016 needs T015; T017 needs T016; T018 needs T014
- **Phase 4 (US2)**: T020/T021 need T010; T022 needs T020; T023 needs T021+T015; T024 needs T022 — independently testable after Foundational
- **Phase 5 (Polish)**: after target stories complete

## Parallel Example

```bash
# Setup batch: T003, T004, T005, T006 together (all different files)
# Foundational tail: T011 (tests) can start once T010 lands
# US2 can run parallel to late-US1 UI work: T022/T023 vs T017/T018
```

## Implementation Strategy

- **MVP**: Phases 1–3 (US1) — dictate → draft. US2's settings/library UI can land second; US1 works with the default device and a manually-selected model via `voice.select` RPC.
- Tests-first per repo convention: write T011/T013/T019 suites, watch them fail, then implement.
- Commit after each task or logical group per AGENTS.md convention.
