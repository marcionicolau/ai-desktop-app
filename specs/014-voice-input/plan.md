# Implementation Plan: Local Voice Input

**Branch**: `014-voice-input` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/014-voice-input/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Push-to-talk-style dictation into the composer, fully offline. The renderer
captures microphone audio with webview-standard `getUserMedia` + an
`AudioWorklet`, resamples to 16 kHz mono via `OfflineAudioContext`, and posts
the clip as base64 s16le PCM over a single typed `voice.transcribe` RPC. The
main process forwards it to a new pull-based `whisper_shim` (`lws_*` C ABI
over vendored whisper.cpp) loaded inside a Bun Worker so a multi-second
transcription never stalls the JS main thread or an in-flight generation
(FR-007). Speech models live in `models/speech/` beside chat GGUFs, scanned
and downloaded through a `voice.*` RPC surface mirroring the existing model
library flow. No microphone/permission → the control degrades gracefully
(FR-006); silence → empty transcript (FR-008).

## Technical Context

**Language/Version**: TypeScript strict (Bun 1.4.x main process, React/Vite renderer); C11 native shim

**Primary Dependencies**: Electrobun 2.x (typed RPC + system webview), whisper.cpp (new vendored native lib, same pattern as llama.cpp), bun:ffi + `Bun.Worker`, Web Audio (`getUserMedia`/`AudioWorklet`/`OfflineAudioContext`) — **zero new JS dependencies**

**Storage**: speech model files in `modelsDir()/speech/`; `settings.json` gains `voice` (selected model, deviceId); recording buffers are in-memory only, never persisted

**Testing**: `bun test ./tests` — `tests/stt/` unit suites (params, service, worker protocol with injected fake shim) + `tests/rpc/voice.test.ts` handler tests; shared s16/base64 helpers in `tests/shared/`

**Target Platform**: Electrobun desktop — Linux verified lane; code paths portable (macOS WKWebView, Windows WebView2 all expose `getUserMedia`)

**Project Type**: desktop-app (Bun main + webview renderer over typed RPC + native shim via bun:ffi)

**Performance Goals**: 10 s clip → transcript < 5 s on dev host with a small model (SC-001); transcription off the main thread so streaming tokens never pause (FR-007)

**Constraints**: recording hard-capped (60 s v1) with elapsed/cap indicator; ≤ ~3.4 MB base64 payload per transcription; zero network for capture/transcribe (FR-009); transcript inserts into draft only, never auto-sends (FR-002)

**Scale/Scope**: ~10 new files (native shim ×2, `src/bun/stt/` ×3, shared audio helpers, renderer `features/voice/` ×3), ~6 touched files (shared types/contract, handlers.ts, settings store, ModelLibrary, Composer); vendored whisper.cpp tree mirrors `src/native/vendor/llama.cpp`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Local-First AI | PASS | whisper.cpp is vendored and reached only through a typed `bun:ffi` shim — same boundary pattern as llama.cpp; zero network for the feature (FR-009). Principle I's "llama.cpp" wording scopes *LLM* inference; STT is new local inference under the same FFI-only rule. |
| II. Electrobun Boundaries | PASS | all capture-to-engine flow crosses `voice.*` methods added to the single shared RPC contract; renderer never touches FFI |
| III. Strict TS & Typed FFI | PASS | new `lws_*` ABI gets a typed dlopen surface in `src/bun/stt/ffi.ts`; PCM payload validated before crossing |
| IV. shadcn/Tailwind v4 | PASS | mic button + indicators compose existing primitives |
| V. Vite pipeline | PASS | renderer additions only; AudioWorklet ships as an inline `Blob` module to keep the Vite/bundle layout untouched |
| VI. Minimal deps | JUSTIFIED | whisper.cpp vendored — offline STT has no browser-API path; capture/resample/encode all use web-standard APIs, no npm additions |

No blocking violations → Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/014-voice-input/
├── spec.md              # feature specification (committed)
├── checklists/requirements.md
├── plan.md              # this file
├── research.md          # Phase 0 — D1–D9 decisions
├── data-model.md        # Phase 1 — SpeechModel, VoiceSettings, session/result records
├── quickstart.md        # Phase 1 — validation scenarios + gates
├── contracts/
│   ├── ffi.md           # Phase 1 — lws_* shim ABI
│   └── rpc.md           # Phase 1 — voice.* requests/messages + settings delta
└── tasks.md             # Phase 2 (/speckit-tasks — NOT this command)
```

### Source Code (repository root)

```text
src/
├── native/
│   ├── vendor/whisper.cpp/        # NEW vendored release (mirrors llama.cpp)
│   └── shim/
│       ├── whisper_shim.c         # NEW pull-based ABI over libwhisper
│       ├── whisper_shim.h         # NEW lws_* exports
│       └── CMakeLists.txt         # + whisper.cpp subdir + whisper_shim target
├── shared/
│   ├── types.ts                   # + SpeechModel, VoiceSettings, VoiceStatus, error codes
│   ├── rpc-contract.ts            # + voice.list/voice.download/voice.select/voice.transcribe,
│   │                              #   voice.status/voice.download events, settings delta
│   └── audio.ts                   # NEW s16le↔f32 + base64 helpers (shared bun/renderer)
├── bun/
│   ├── stt/
│   │   ├── ffi.ts                 # NEW loadWhisperShim (path rules copied from llama/ffi.ts)
│   │   ├── worker.ts              # NEW Bun Worker entry: owns dlopen + lws_* calls
│   │   └── service.ts             # NEW SpeechService — worker lifecycle, single-flight
│   │                              #   transcribe, lazy model load, models/speech scan
│   ├── store/json-store.ts        # + Settings.voice
│   └── rpc/handlers.ts            # + voice.* handlers (deps.speech injectable)
└── renderer/src/features/voice/
    ├── use-voice.ts               # NEW getUserMedia + AudioWorklet + resample + RPC
    ├── VoiceButton.tsx            # NEW mic toggle + elapsed/cap indicator + disabled reason
    └── SpeechModels.tsx           # NEW speech section inside ModelLibrary (list/download/select)
```

**Structure Decision**: feature mirrors the established three-layer layout —
a pull-based C shim next to `llama_shim`, a `src/bun/stt/` service module
sibling to `src/bun/llama/`, shared contract/types in `src/shared/`, and a
`features/voice/` renderer module. Audio capture lives renderer-side because
the webview already owns device enumeration and permission prompts; the
engine lives native-side because FFI must not cross into the renderer
(constitution I/II).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations.
