# Packaging

Cross-platform build + validation guide. **Status: linux-x64 verified;
macOS + Windows configured, not verified** (feature 012).

## Per-OS build

Prereqs: **Bun**, **cmake**, C++ toolchain (gcc/clang; MSVC or clang-cl on
Windows). `build-native.*` fails fast naming whatever is missing.

| OS | Steps | Output |
|----|-------|--------|
| linux-x64 | `bun install` → `scripts/build-native.sh` → `bun run build:renderer` → `bun run build` | `build/canary-linux-x64/` |
| darwin-arm64 | same as Linux | `build/canary-darwin-arm64/` |
| darwin-x64 | same, on Intel mac | `build/canary-darwin-x64/` |
| win-x64 | `bun install` → `scripts\build-native.ps1` → `bun run build:renderer` → `bun run build` | `build\canary-win-x64\` |

`bun run build:stable` swaps `--env=canary` for `--env=stable` (and sets
`RELEASE_CHANNEL=stable` for versioning).

## Versioning

`app.version` comes from `scripts/version.ts` (`computeVersion`) — semver
derived from git, no manual bumps:

- tagged HEAD → exact tag (`v1.2.3` → `1.2.3`)
- N commits past tag → `1.2.3-canary.N` / stable `1.2.3+N`
- no tags → `<package.json version>-canary.<total commits>`

## Native library staging

- `build-native.sh` (linux/darwin, x64/arm64) and `build-native.ps1`
  (win-x64) compile the llama.cpp shim via cmake into `native/build/<plat>`
  and stage the runtime lib set flat into `native/out/<plat>/`.
- `electrobun.config.ts` maps `native/out` → `native/` inside the bundle.
- `$ORIGIN` (Linux) / `@loader_path` (macOS) RUNPATH makes the packaged
  shim resolve `libllama`/`libggml` next to itself — no absolute build
  paths leak into the artifact. Windows resolves sibling `.dll`s by
  default.

## Verify

```bash
scripts/verify-artifact.sh build/canary-linux-x64   # structural PASS
```

Checks binary present+executable, required lib set under `native/<plat>/`
(`libllama_shim`, `libllama*`, `libggml*`), `views/main/index.html`.
Handles both dev (`Resources/app/`) and canary/stable
(`Resources/*.tar.zst`) layouts.

## Smoke checklist (manual, per OS)

1. Launch → main window appears (no native-load error).
2. Put a `.gguf` in `models/` → model select → loads to ready.
3. Send a message → tokens stream to completion.
4. Close window → clean exit.

## Architecture policy

x64 primary on all three OSes; macOS arm64 via arm64 runner/host.
Artifact names carry `canary|stable-<os>-<arch>`. No universal binaries
(would need lipo-merged cmake outputs — deferred).

## Signing & distribution

Credentials are org secrets — never committed.

- **macOS**: `build.mac.codesign`/`notarize` in `electrobun.config.ts`,
  default `false`. With a Developer ID identity: set both `true` + provide
  `entitlements`; `createDmg` produces a `.dmg`. Unsigned builds pass
  Gatekeeper via right-click → Open on first launch.
- **Windows**: Electrobun has no built-in sign step — sign the exe
  post-build: `signtool sign /fd SHA256 /a AIDesktopApp.exe`. Unsigned
  builds trigger SmartScreen "unknown publisher" (click-through on dev).
- **Linux**: nothing to sign; the `.desktop` + self-extracting launcher
  install to `~/.local/share/<identifier>/<channel>/app/`.

## CI

`.github/workflows/packaging.yml` — matrix with per-entry `enabled` flag.
Linux lane runs on push/PR; macOS/Windows lanes exist with
`enabled: false` — flip when runner access (and certs) are arranged.
