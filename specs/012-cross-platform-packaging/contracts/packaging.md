# Packaging Contract — per-OS build, staging, smoke, signing

## Per-OS build steps

Prerequisites per OS: **Bun**, **cmake**, a C++ toolchain (gcc/clang on
Linux/macOS, MSVC or clang-cl on Windows). `build-native.*` fails fast
naming the missing tool (FR-004).

| OS | Steps |
|----|-------|
| linux-x64 | `bun install` → `scripts/build-native.sh` → `bun run build:renderer` → `bun run build` → `build/canary-linux-x64/` |
| darwin-arm64 | `bun install` → `scripts/build-native.sh` → `bun run build:renderer` → `bun run build` → `build/canary-darwin-arm64/` |
| darwin-x64 | same, on an Intel mac or a `-x64` runner |
| win-x64 | `bun install` → `scripts\build-native.ps1` → `bun run build:renderer` → `bun run build` → `build\canary-win-x64\` |

`build:stable` swaps `--env=canary` → `--env=stable` everywhere.

## Staged native lib contract

`scripts/stage-native.ts` copies into `native/out/<platform>/` (→ `native/`
inside the bundle):

| OS | Required |
|----|----------|
| linux | `libllama_shim.so`, `libllama.so*`, `libggml*.so*` |
| darwin | `libllama_shim.dylib`, `libllama.dylib*`, `libggml*.dylib*` |
| win | `llama_shim.dll`, `llama.dll`, `ggml*.dll` |

`scripts/verify-artifact.sh <build/canary-*/>` asserts binary + lib set +
`views/main/index.html`. Runtime resolution is baked by the shim's
`dlopen` of staged paths — the smoke checklist launch exercises it
(FR-008).

## Smoke checklist (per OS, manual)

1. Launch the artifact → main window appears (no native-load error).
2. Put a `.gguf` in `models/` → open model select → model loads to ready.
3. Send a message → tokens stream to completion.
4. Close the window → process exits cleanly (no lingering helpers).

## Architecture policy (FR-007)

- x64 is the primary arch on all three OSes; macOS arm64 is supported via
  an arm64 runner/host.
- Artifact names carry `canary|stable-<os>-<arch>`; no universal/fat
  binaries (would require lipo-merging two cmake outputs — deferred).

## Signing & distribution notes (FR-006)

- **macOS**: `build.mac.codesign` + `notarize` exist in config, default
  `false`. With an org Developer ID, enable both and provide entitlements;
  unsigned builds require "right-click → Open" past Gatekeeper on first
  launch. `createDmg: true` produces a `.dmg` alongside the bundle.
- **Windows**: Electrobun has no built-in sign step — sign
  `AIDesktopApp.exe` post-build with `signtool sign /fd SHA256` + cert;
  unsigned builds trigger SmartScreen "unknown publisher" (user clicks
  through on dev builds).
- Credentials are org secrets — never committed (constitution; spec
  assumptions).
