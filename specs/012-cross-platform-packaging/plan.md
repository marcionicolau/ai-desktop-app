# Implementation Plan: Cross-Platform Packaging Validation

**Branch**: `012-cross-platform-packaging` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/012-cross-platform-packaging/spec.md`,
scoped by user directive: **complete configuration for all three platforms,
only Linux enabled/verified** — macOS and Windows lanes ship configured but
inactive (CI jobs gated off, docs marked unverified).

## Summary

Wire a complete per-OS packaging path: fill `electrobun.config.ts`
`build.{mac,win,linux}` sections, keep the per-OS native shim staging
(`build-native.sh`/.ps1 → `native/out/<os>-<arch>/`), add a prerequisite
fail-fast check, create a CI packaging matrix where the Linux lane runs and
the macOS/Windows lanes exist but are gated off, add an artifact-verification
script (staged lib set + launchable binary) usable locally and in CI, and
document per-OS build steps, smoke checklist, arch policy, and
signing/notarization notes.

## Technical Context

**Language/Version**: TypeScript strict (Bun), bash + PowerShell packaging
scripts, YAML (GitHub Actions)

**Primary Dependencies**: Electrobun 2.0.6 (`electrobun build --env=canary|stable`),
CMake (native shim), Vite (renderer), GitHub Actions

**Storage**: `native/out/<os>-<arch>/` staged libs; `build/<env>-<platform>/` artifacts

**Testing**: `bun test ./tests`, `bun run typecheck`, `bun run lint`,
`scripts/verify-artifact.sh` structural check

**Target Platform**: Linux x64 (enabled/verified); macOS arm64+x64, Windows x64
(configured, not verified)

**Project Type**: desktop app packaging/CI

**Constraints**: no cross-compilation — Electrobun builds on-host only; CI
matrix is the only way to produce macOS/Windows artifacts. Local-first:
native shim (llama.cpp) MUST be inside every artifact.

**Scale/Scope**: config + 1 workflow + 2 scripts + docs — no app code changes
(FR-010).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict |
|-----------|---------|
| I. Local-first inference | PASS — the native shim IS the llama.cpp binding; per-OS staging keeps it inside every artifact |
| II. Electrobun boundaries | PASS — packaging touches the shell only via official `electrobun build` |
| III. Strict TS / typed FFI | PASS — scripts typed (stage-native.ts, verify); no FFI changes |
| IV. Component standardization | N/A — no renderer changes |
| V. Vite pipeline | PASS — build order unchanged (renderer → native → electrobun) |
| VI. Minimal dependencies | PASS — zero new packages; cmake/gha/bash/ps1 only |

## Project Structure

### Documentation (this feature)

```text
specs/012-cross-platform-packaging/
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/packaging.md  # per-OS build + smoke checklist + signing notes
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
electrobun.config.ts            # + build.{mac,win,linux} sections
scripts/
├── build-native.sh             # + prereq fail-fast (cmake/compiler named)
├── build-native.ps1            # + same prereq check (win-x64)
├── stage-native.ts             # existing lib scanner (unchanged expected)
└── verify-artifact.sh          # NEW: staged lib set + binary sanity per OS
.github/workflows/
└── packaging.yml               # NEW: matrix — linux enabled, mac/win gated
docs/packaging.md               # NEW: build steps + smoke checklist + signing
justfile                        # + package/package-stable convenience recipes
```

## Phase 0 — research.md decisions

1. **Electrobun build scope** — on-host only, no cross-compile; "complete
   config" = populated `build.{mac,win,linux}` so each host build works.
2. **CI enablement pattern** — matrix `include:` with per-entry `enabled`
   flag + `if: matrix.enabled`; flipping a boolean activates the lane.
3. **Arch policy** — x64 primary everywhere; macOS arm64 via
   `macos-latest` (arm) runner label when enabled; artifact names carry
   `<os>-<arch>`.
4. **Verification without GUI** — `verify-artifact.sh` structural check
   (binary present+executable, required lib set present, renderer bundle
   present); interactive smoke checklist stays manual in docs.
5. **Signing** — config exposes codesign/notarize toggles OFF by default;
   docs cover enabling + unsigned-dev caveats.

## Phase 1 — artifacts

- `data-model.md`: PlatformArtifact / SmokeChecklist / CILane entities.
- `contracts/packaging.md`: per-OS build commands, staged-lib contract,
  smoke checklist, signing notes, artifact naming.
- `quickstart.md`: runnable validation on this Linux host.
