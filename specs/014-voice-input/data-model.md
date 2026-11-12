# Data Model: Local Voice Input

Entities crossing the RPC/FFI boundary. Recording-session state is
renderer-local and never persisted; the only new persisted shape is
`Settings.voice`.

## SpeechModel (shared/types.ts)

A speech model file discovered under `modelsDir()/speech/`.

```ts
interface SpeechModel {
  path: string;        // absolute path under models/speech/
  fileName: string;    // basename — selection + display key
  sizeBytes: number;
  format: "gguf" | "bin";   // extension-derived; .bin = legacy ggml file
  name: string | null;      // gguf header name when readable, else null
}
```

- Directory membership defines the type — no chat-model fields (no
  `contextTrain`, `quantization`, `paramCount`).
- `.part` in-flight downloads are filtered out (same as `scanModels`).

## VoiceSettings (Settings.voice)

```ts
interface VoiceSettings {
  modelPath: string | null;   // selected speech model; null = unbound
  deviceId: string | null;    // preferred capture device; null = OS default
}
```

- Absent on upgrade → `{ modelPath: null, deviceId: null }` (seeded on
  read, same pattern as other settings additions).
- `modelPath` stored as **absolute path**; stale value (file deleted)
  resolves to a `re-download`-style notice on next transcribe — never a
  crash.
- `deviceId` values are origin/session-scoped browser ids — treated as a
  hint; unknown id at record time falls back to the default device.

## RecordingSession (renderer-local, in-memory)

```ts
interface RecordingSession {
  deviceId: string | null;
  startedAt: number;          // ms epoch
  durationMs: number;         // live, for the elapsed/cap indicator
  samples: Float32Array;      // grown while capturing; dropped on stop
}
```

- Hard bound: `VOICE_MAX_SECONDS` (60) — capture auto-stops; buffer is
  freed whether the user sends, cancels, or errors.
- Never serialized — audio exists only in renderer memory until the
  transcribe request fires.

## VoiceTranscribeRequest / VoiceTranscript (RPC)

```ts
interface VoiceTranscribeRequest {
  audio: string;        // base64, s16le PCM
  sampleRate: 16000;    // contract constant — renderer resamples
  channels: 1;          // mono only
}
interface VoiceTranscript {
  text: string;         // may be "" (silence/undecodable — FR-008)
  durationMs: number;   // engine-side transcribe wall time
  modelFile: string;    // basename of the model that produced it
}
```

## VoiceStatus (webview message payload)

```ts
type VoiceStatus =
  | { state: "idle" }
  | { state: "loading"; modelFile: string }
  | { state: "transcribing"; modelFile: string };
```

- Drives the composer busy indicator; `idle` is implied between messages
  (no explicit idle emits required after a terminal response).

## DownloadState (reuse)

`voice.download` events reuse the existing `{fileName, phase:
"progress"|"done"|"error", downloadedBytes, totalBytes, error?}` shape —
no new download entity.

## State transitions

```text
unbound ──select──▶ bound ──transcribe──▶ loading → transcribing → idle
   │                                       │
   └─ file missing on next use ─▶ modelPath stale → re-download notice
```

Validation rules:

- `audio` must base64-decode to `sampleRate × channels × 2 × seconds`
  bytes and ≤ `VOICE_MAX_SECONDS`; otherwise `INVALID_PARAMS`.
- `voice.select` requires an existing file under `models/speech/` →
  `MODEL_NOT_FOUND` otherwise.
- Second concurrent `voice.transcribe` → `VOICE_BUSY` (single-flight,
  no queue).
