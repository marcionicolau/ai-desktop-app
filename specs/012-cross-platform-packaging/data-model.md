# Data Model — 012 Cross-Platform Packaging

## PlatformArtifact

Output of `electrobun build --env=<env>` on one host.

| Field | Notes |
|-------|-------|
| `env` | `canary` \| `stable` |
| `platform` | `linux-x64` \| `darwin-x64` \| `darwin-arm64` \| `win-x64` |
| `path` | `build/<env>-<platform>/` |
| `binary` | `AIDesktopApp` (linux/mac), `AIDesktopApp.exe` (win) |
| `nativeLibs` | staged set under `native/`: `libllama_shim`, `libllama`, `libggml*` |
| `renderer` | `views/main/index.html` + Vite assets |

Validation: `verify-artifact.sh` — binary exists + executable,
`nativeLibs` present (per-OS extension), `renderer` present.

## SmokeChecklist

Ordered manual steps per OS (contracts/packaging.md):

1. launch artifact → window appears
2. place a GGUF in `models/` → model loads (select → status ready)
3. send a message → streamed response
4. close window → clean exit

## CILane

One matrix entry in `packaging.yml`.

| Field | Values |
|-------|--------|
| `os` | `ubuntu-latest` \| `macos-latest` \| `windows-latest` |
| `platform` | matches PlatformArtifact.platform |
| `enabled` | `true` (linux) / `false` (mac, win) |
| `steps` | setup bun+cmake → build-native → renderer → electrobun build → verify → upload artifact |

## Relationships

`CILane` produces `PlatformArtifact`; `SmokeChecklist` validates it.
