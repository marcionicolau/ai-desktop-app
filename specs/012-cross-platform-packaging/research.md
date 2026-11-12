# Research — 012 Cross-Platform Packaging

## R1 — Electrobun build model

**Decision**: Populate `build.{mac,win,linux}` in `electrobun.config.ts`;
each platform builds on its own host — Electrobun has no cross-compile.

**Rationale**: `hutch electrobun build --env=canary` packages the host
platform only. "Complete config" therefore means each OS's section is
filled so a build on that host works out of the box; verification of
non-Linux lanes is delegated to CI lanes (gated) + docs.

**Alternatives**: cross-building toolchains — rejected (Electrobun doesn't
support it); Docker for Linux only — already covered natively.

## R2 — Available per-OS config surface (devkit ElectrobunConfig)

- `build.mac`: `codesign`, `notarize`, `createDmg` (default true),
  `bundleCEF`, `bundleWGPU`, `defaultRenderer`, `chromiumFlags`,
  `entitlements`, `icons` (.iconset → iconutil / .icon → actool).
- `build.win`: `bundleCEF`, `bundleWGPU`, `defaultRenderer`,
  `chromiumFlags`, `autoGrantPermissions`, `icon` (.ico/.png).
- `build.linux`: `bundleCEF`, `bundleWGPU`, `defaultRenderer`,
  `chromiumFlags`, `flatpak` recipe emit (opt-in).
- `release.baseUrl` + `generatePatch` — deferred (auto-update is #013).

**Decision**: conservative defaults — native renderers (no CEF bundle),
`createDmg` true, signing toggles OFF (env-free default), icon paths set
but files optional until assets exist.

## R3 — Native staging (existing, verified)

- `build-native.sh` covers linux/darwin + x64/arm64 → `native/out/<os>-<arch>/`.
- `build-native.ps1` targets `win-x64`.
- `stage-native.ts` copies `libllama_shim`/`libllama`/`libggml*`
  (.so/.dylib/.dll incl. versioned names) flat into the out dir.
- `electrobun.config.ts` `copy` maps `native/out` → `native` in resources;
  on a clean checkout only the host's `<os>-<arch>` dir exists → correct
  per-OS staging for free.

**Gap**: no fail-fast for missing cmake/compiler (FR-004) → add prereq
check naming the missing tool.

## R4 — CI enablement pattern

**Decision**: single `packaging.yml` matrix with `include:` entries
carrying an `enabled` boolean; every job gated on `if: matrix.enabled`.
Linux lane `enabled: true`; macOS/Windows `enabled: false` with a comment
("flip when runner access is arranged").

**Rationale**: self-documenting, one-line activation, no commented-out
YAML rot. **Alternatives**: separate workflows per OS (drift), fully
commented lanes (invisible).

## R5 — Arch policy

**Decision**: x64 primary on all three; macOS arm64 supported via the
`macos-latest` arm runner when that lane is enabled; artifact names
`ai-desktop-app-<env>-<os>-<arch>`.

**Rationale**: llama.cpp shim builds per-arch; universal macOS binaries
would require lipo-merging two cmake outputs — not worth it pre-CI.

## R6 — Verification without a display

**Decision**: `scripts/verify-artifact.sh <artifact-dir>` — asserts the
app binary exists and is executable, the required native lib set is
present under `native/`, and `views/main/index.html` exists. Used by CI
(linux lane) and locally; the human smoke checklist (launch → model →
chat → stream) lives in contracts/packaging.md for real machines.

**Rationale**: packaged electrobun apps can't run headless reliably in CI
linux containers without X — structural check is the honest automated
gate.

## R7 — Signing

**Decision**: `mac.codesign`/`mac.notarize` present but `false`; docs
describe enabling with org credentials. Windows: Electrobun exposes no
sign hook — docs cover `signtool` post-build; unsigned caveat documented.

**Rationale**: FR-006 = document, not implement signing infrastructure.
