# Quickstart: Local Voice Input

Validation guide — runnable scenarios that prove the feature end-to-end.
Details live in [contracts/rpc.md](contracts/rpc.md),
[contracts/ffi.md](contracts/ffi.md), and [data-model.md](data-model.md).

## Prerequisites

- `bun install` + `bun x electrobun prepare` (toolchain healthy)
- Native build including the new shim:

  ```bash
  bun run build:native   # produces native/out/<platform>/libwhisper_shim.*
                       # alongside libllama_shim + libwhisper
  ```

- A speech model in `models/speech/` — via the in-app Speech section
  (`voice.download`) or by dropping a `ggml-*.bin` / whisper `*.gguf`
  file there.

## Gates (must pass)

```bash
bun run typecheck
bun run lint
bun test ./tests            # scoped — see tests/stt/, tests/rpc/voice.test.ts
bun run build:renderer
```

## Automated coverage

- `tests/stt/` — s16/base64 round-trip + 16 kHz contract enforcement
  (`tests/shared/audio.test.ts`); `SpeechService` single-flight
  (`VOICE_BUSY`), lazy load, model-free on select, error mapping with an
  injected fake worker/shim.
- `tests/rpc/voice.test.ts` — `voice.transcribe` validation
  (`INVALID_PARAMS` on bad payload/oversize), `NO_MODEL` when unbound,
  `voice.select` path checks (`MODEL_NOT_FOUND` outside `speech/`),
  `VOICE_UNAVAILABLE` when `deps.speech` absent, settings round-trip.
- `tests/stt/download.test.ts` — speech-dir targeting, `.gguf|.bin`
  allowlist, `.part` cleanup on error.

## Manual scenarios (`bun run dev`)

### S1 — Dictate a message (US1 / FR-001/002)

1. Download + select a speech model in the model library Speech section.
2. Click the mic button in the composer → recording indicator shows
   elapsed time; speak a sentence; click again to stop.
3. **Expect**: busy indicator during `voice.status` transitions, then
   the transcript lands in the draft — editable, **not** sent.
4. Send it normally — existing chat flow untouched.

### S2 — Device & model management (US2 / FR-003/004)

1. With two input devices present, pick the second in voice settings;
   record → transcript reflects that mic.
2. Switch the selected speech model → next transcription uses it
   (`modelFile` in the response / metrics differs).

### S3 — Grace cases (FR-005/006/007/008)

- **Cap**: hold a recording past 60 s → auto-stops at the cap and
  transcribes what it has.
- **No mic / denied**: revoke permission or remove devices → mic button
  disables with a stated reason; typing unaffected.
- **During generation**: start a reply, then dictate → capture works
  while tokens stream; transcription never pauses the stream.
- **Silence**: record a few quiet seconds → empty transcript, no error.
- **Model deleted**: remove the bound file from `models/speech/` → next
  transcribe surfaces a re-download notice; typing unaffected.
- **No model**: activate voice input with no speech model → UI routes to
  the Speech download flow instead of erroring (US1 scenario 3).

### S4 — Offline posture (SC-004)

Disable networking (or run with `UPDATE_FEED_BASE_URL` unreachable) and
repeat S1 — capture, transcription, and model listing all work offline;
downloads are the only networked step.
