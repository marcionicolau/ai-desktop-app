# Research: Local Voice Input

All spec-level unknowns were resolved at spec time (no `[NEEDS
CLARIFICATION]` markers). The open questions were design mechanisms,
decided here against the post-021 `main` architecture — this branch's
codebase is older, so paths/conventions below reference `origin/main`.

## D1 — Speech-to-text engine

**Decision**: vendor **whisper.cpp** under `src/native/vendor/whisper.cpp`,
built as `libwhisper` via the existing shim CMake tree.

**Rationale**: spec assumption names it explicitly; it is the established
offline C/C++ STT engine, uses the same ggml stack already vendored and
packaged, ships small (`ggml-tiny`/`base`) English or multilingual models
that satisfy SC-001, and its C API (`whisper_init_from_file*`,
`whisper_full`) fits the repo's pull-based shim convention with no worker
threads inside C.

**Alternatives considered**: (a) sherpa-onnx / Vosk — extra runtime
complexity, no ecosystem match; (b) Web Speech API — not offline and
unsupported/remote in WKWebView/WebKitGTK, violates FR-009; (c) llama.cpp
native audio models — not a general STT path in the vendored version.

## D2 — Audio capture location

**Decision**: capture in the **renderer** via `getUserMedia` +
`AudioWorklet`, never in native code.

**Rationale**: all three Electrobun webviews (WKWebView, WebView2,
WebKitGTK) expose `navigator.mediaDevices`; device enumeration
(`enumerateDevices` → `deviceId` constraint) and the OS permission prompt
come free, which is exactly what FR-003/FR-006 need — denial and
no-device map to `NotAllowedError`/`NotFoundError`, rendered as a
disabled button with a reason. Writing native capture (ALSA/PulseAudio/
WASAPI/CoreAudio or a new dep like miniaudio) would be the largest piece
of new code in the feature for zero user-visible gain, and would push
device/permission handling into platform code.

**Alternatives considered**: (a) native capture in the shim — rejected
above; (b) `MediaRecorder` → encoded blob → decode engine-side — rejected,
transcoding adds a codec dependency and whisper wants raw PCM anyway.

## D3 — Resampling & payload format

**Decision**: renderer buffers raw `Float32` frames at context rate, then
resamples the whole clip to **16 kHz mono** with `OfflineAudioContext`
and encodes **s16le base64**.

**Rationale**: `whisper_full` wants 16 kHz mono f32; `OfflineAudioContext`
resamples with the platform's high-quality path — zero DSP code, zero
deps. s16le halves the payload vs f32 (~3.4 MB base64 at the 60 s cap);
the shim converts s16→f32 in one pass, which is trivial C.

**Alternatives considered**: (a) streaming chunks mid-record — adds
session state for no benefit under the hard cap; (b) hand-rolled linear
resampler — worse quality, real code to test; (c) f32 transport — 2× the
bytes for nothing the engine needs.

## D4 — Transcription threading

**Decision**: the whisper shim is dlopened inside a dedicated **Bun
Worker** (`src/bun/stt/worker.ts`); `voice.transcribe` posts the PCM
payload to it and awaits the response.

**Rationale**: a `whisper_full` call is synchronous and takes seconds
(SC-001 budgets 5 s). On the JS main thread it would freeze the stepped
generation loop mid-stream — the FR-007 requirement that voice never
block a generation in progress is only truly met on another thread. Bun
supports `bun:ffi` inside Workers; the worker owns the model handle, so
the main thread never sees an FFI pointer.

**Alternatives considered**: (a) main-thread transcribe — simplest but
pauses token streaming for the full duration; (b) C-side worker thread in
the shim — breaks the shim's documented single-threaded/pull contract and
needs a JSCallback to report completion; (c) stepped transcription like
`lls_step` — `whisper_full` is not incremental.

## D5 — Shim shape

**Decision**: a **separate** `whisper_shim` library (`lws_*` symbols,
`src/native/shim/whisper_shim.{c,h}`), not new symbols on `llama_shim`.

**Rationale**: keeps `llama_shim` untouched (its ABI is stable and
KV-state features depend on it), lets the voice feature degrade cleanly
when the shim is absent (same toleration pattern as `scanModels`), and
keeps each dlopen surface small and typed (constitution III). The ABI is
one-shot: `lws_model_load/free`, `lws_ctx_create/free`,
`lws_transcribe(ctx, pcm_s16, n, params) → shim-allocated char*` freed via
`lws_free_string` — matching the `lls_gguf_meta` allocation precedent.

## D6 — Speech model storage & download

**Decision**: speech models live in `modelsDir()/speech/` (`*.gguf`,
`*.bin` accepted); `voice.download` mirrors `model.download` — HF
allowlist regex, `.part` → rename, progress events — writing into the
speech dir.

**Rationale**: directory separation makes "distinct from chat models"
(FR-004) structural — `scanModels` never picks up a whisper file and vice
versa — without a new typing/migration mechanism. `lls_gguf_meta` cannot
sniff legacy `ggml-*.bin` files, so directory is also the more reliable
discriminator than header sniffing. Download reuses the proven
single-flight writer + event pattern; the allowlist widens to `.bin` for
this route only.

**Alternatives considered**: (a) one flat dir + `kind` field — mixes
selection lists and needs sniffing to classify `.bin`; (b) reuse
`model.download` with a `subdir` param — would leak voice concerns into
the chat-model path and weaken the `.gguf`-only allowlist for everyone.

## D7 — Recording control

**Decision**: **toggle** (click to start, click/auto-stop at 60 s cap)
with an elapsed-time indicator; push-to-talk-hold is not in v1.

**Rationale**: spec allows either ("push-to-talk or toggle"); toggle is
the simpler interaction (no pointer-capture/focus-loss edge cases) and
covers the same FR-001 requirement. The cap is a shared constant
(`VOICE_MAX_SECONDS = 60`), enforced renderer-side with auto-stop —
bounded memory per spec's edge cases.

**Alternatives considered**: hold-to-record (extra gesture handling, no
added requirement), voice-activity auto-stop (deferred — needs VAD the
engine doesn't expose cheaply).

## D8 — Model lifecycle

**Decision**: lazy load on first `voice.transcribe`; the worker caches
one loaded model; `voice.select` switches (free + load on next use);
status surfaces via `voice.status` messages (`loading|transcribing`).

**Rationale**: mirrors the chat engine's lazy single-flight behavior; one
speech model resident keeps memory bounded and matches single-user use.
Busy state is single-flight: a second `voice.transcribe` while one is in
flight returns `VOICE_BUSY` instead of queuing.

## D9 — Language / params

**Decision**: v1 sends no language — shim passes `nullptr`/auto-detect to
`whisper_full`; only `n_threads` is plumbed (default shim choice). No
timestamps, diarization, or partial results (spec assumption).

**Rationale**: auto-detect keeps the RPC surface minimal; English-only
`.en` model files still work (the model itself constrains detection).
A `language` field can be added later without ABI breakage via
`lws_stt_params`.

## Resolved Technical Context

- **Capture**: renderer `getUserMedia` + `AudioWorklet` (inline Blob
  module — no extra bundle entry), `OfflineAudioContext` resample.
- **Transport**: single `voice.transcribe` request, base64 s16le @16 kHz
  mono, hard-capped by `VOICE_MAX_SECONDS`.
- **Engine**: vendored whisper.cpp behind `whisper_shim` (`lws_*`), run
  on a Bun Worker; single-flight; lazy load.
- **Models**: `models/speech/`, `voice.list`/`voice.download`/
  `voice.select`; selection + `deviceId` persisted in `settings.voice`.
- **Grace**: `NotAllowedError`/`NotFoundError` → disabled control with
  reason; empty/silent audio → `""` transcript, never an error.
