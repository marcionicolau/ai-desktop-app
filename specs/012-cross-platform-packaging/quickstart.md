# Quickstart — 012 Cross-Platform Packaging (Linux-verified)

## Prerequisites

bun, cmake, a C++ toolchain — `scripts/build-native.sh` names whatever is
missing.

## Scenarios

### S1 — Linux artifact end-to-end (verified on this host)

```bash
bun install
scripts/build-native.sh        # → native/out/linux-x64/
bun run build:renderer         # → dist/renderer/
bun run build                  # → build/canary-linux-x64/
scripts/verify-artifact.sh build/canary-linux-*/   # structural PASS
```

Then the manual smoke checklist (contracts/packaging.md): launch → model
load → chat → stream → clean exit.

### S2 — Prereq fail-fast (FR-004)

Temporarily shadow `cmake` from PATH → `build-native.sh` exits naming
`cmake` (not a cryptic compiler error).

### S3 — CI lanes

`.github/workflows/packaging.yml` — linux job runs on push/PR and uploads
`build/canary-linux-x64` as an artifact; `macos` + `windows` jobs are
present with `enabled: false` (flip to activate when runners/certs are
arranged). Verify in-repo with `actionlint` or `gh workflow view` once
pushed.

### S4 — Config completeness (mac/win, unverified)

`electrobun.config.ts` `build.{mac,win}` sections exist with sane
defaults; `build-native.ps1` + `stage-native.ts` patterns cover `.dll`;
docs mark both lanes **configured, not verified**.

## Pass/fail evidence

- `verify-artifact.sh` green on the Linux artifact.
- Existing gates: `bun run typecheck`, `bun test ./tests`, `bun run lint`.
- CI linux lane green on the feature branch; mac/win lanes skipped.
