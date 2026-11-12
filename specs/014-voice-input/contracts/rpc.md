# Contract: `voice.*` RPC surface

All additions live in the shared `ChatRpcSchema` (constitution II).
`deps.speech` on the handlers factory is the injectable seam — absent ⇒
voice handlers respond `VOICE_UNAVAILABLE` so headless tests stay safe
(precedent: `deps.snapshots`, `deps.dialogs`).

## Bun requests (renderer → main)

| Method | Params | Response | Notes |
|---|---|---|---|
| `voice.list` | `{}` | `{ models: SpeechModel[] }` | scans `modelsDir()/speech/` |
| `voice.download` | `{ url: string; fileName: string }` | `{ fileName: string }` | HF allowlist `…/resolve/<rev>/<file>.(gguf\|bin)`; `.part`→rename; ack only, completion via `voice.download` message |
| `voice.select` | `{ path: string }` | `{}` | file must exist under `models/speech/` → `MODEL_NOT_FOUND`; persists `settings.voice.modelPath` |
| `voice.transcribe` | `{ audio: string; sampleRate: 16000; channels: 1 }` | `{ text: string; durationMs: number; modelFile: string }` | base64 s16le mono 16 kHz; validation → `INVALID_PARAMS`; no model bound/missing file → `NO_MODEL`; in-flight → `VOICE_BUSY`; shim missing/failure → `ENGINE_ERROR` |

## Webview messages (main → renderer)

| Message | Payload | When |
|---|---|---|
| `voice.status` | `VoiceStatus` | model `loading` / `transcribing` transitions during `voice.transcribe` |
| `voice.download` | `{ fileName, phase, downloadedBytes, totalBytes, error? }` | progress/throttled ≥4 MiB + `done`/`error`, same as `model.download` |

## Settings delta

`settings.get` response and `settings.set` params gain:

```ts
voice?: { modelPath: string | null; deviceId: string | null }
```

`settings.set` accepts partial `{ voice: { deviceId } }` merges; `modelPath`
writes outside `voice.select` are ignored (selection must validate the
file — keep the invariant in one place).

## Error-code additions

`RPC_ERROR_CODES` gains `"VOICE_BUSY"` and `"VOICE_UNAVAILABLE"`.
Existing codes reused: `NO_MODEL` (none bound / file gone), `INVALID_URL`,
`INVALID_PARAMS`, `ALREADY_EXISTS`, `DOWNLOAD_FAILED`, `ENGINE_ERROR`.

## Renderer-side (no RPC)

Device enumeration (`mediaDevices.enumerateDevices`), permission state,
and capture never cross the bridge — the composer mic control handles
`NotAllowedError`/`NotFoundError` locally (FR-003/FR-006).
