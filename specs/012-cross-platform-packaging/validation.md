# Validation — 012 Cross-Platform Packaging

## S1 — Linux artifact end-to-end: PASS

- `scripts/build-native.sh` → staged flat lib set to `native/out/linux-x64/`
- `bun run build` → `build/canary-linux-x64/` (~62 MB)
- `verify-artifact.sh` PASS on canary (`*.tar.zst` layout) AND dev
  (`Resources/app/`) layouts
- **Launch**: self-extractor installed to
  `~/.local/share/dev.local.ai-desktop-app/canary/app/`; bundled app
  launched, GTK event loop + webview up (GLXBadWindow = benign X11 quirk)
- **Native resolution (FR-008)**: `/proc/<pid>/maps` shows
  `libllama_shim`, `libllama`, `libggml*` ALL loading from
  `Resources/app/native/linux-x64/` inside the bundle — verified after
  the `$ORIGIN` RUNPATH fix (previously resolved from the dev checkout)
- Model load / chat / stream: same code path verified live in dev
  sessions (021); packaged-binary chat turn not re-driven manually.

## S2 — Prereq fail-fast: PASS (mechanism)

`build-native.sh`/`build-native.ps1` check bun/cmake/toolchain up front
and exit naming the missing tool (FR-004) before any cmake invocation.

## S3 — CI lanes: PASS (config)

`.github/workflows/packaging.yml` — matrix `{os,platform,enabled,
native-script,shell-kind}`; `ubuntu-latest` `enabled:true`,
`macos-latest`/`windows-latest` `enabled:false` gated on
`if: matrix.enabled`. YAML validates (no actionlint installed). Linux
lane steps mirror the verified local flow + `upload-artifact`.

## S4 — Config completeness: PASS

`build.{mac,win,linux}` sections populated with conservative defaults
(native renderers, signing off, DMG on); `build-native.ps1` +
`stage-native.ts` patterns cover `.dll`; docs mark mac/win
"configured, not verified".

## Found during implementation

- **FR-002 gap**: cmake build tree inside `native/out/` was being
  packaged (~25 MB of objects + dup libs) — moved to `native/build/`.
- **FR-008 violation**: shim RUNPATH was an absolute build-tree path →
  packaged app only worked where the dev checkout existed. Fixed with
  `$ORIGIN`/`@loader_path` on shim + ggml/llama targets (T014).
- **pkill self-match**: `pkill -f <path>` matched the invoking shell's
  own cmdline when the path appeared in other args — use PID lists or
  bracket patterns that can't appear in your own command.

## Gates

- `bun run typecheck`: PASS
- `bun test ./tests`: PASS (395)
- `bun run lint`: 0 errors
- `bun run build:renderer` + `bun run build`: PASS

## Convergence validation

| Check | Result | Notes |
|-------|--------|-------|
| T016 fresh-worktree `just package` | ✅ PASS | `git worktree` at HEAD: submodule init → `bun install` → `electrobun prepare` → `just package` → `verify-artifact: PASS` in 2m28s |
| T015 packaged smoke incl. chat turn | ⏳ open | Needs a manual GUI pass — launch + bundled lib resolution verified |
