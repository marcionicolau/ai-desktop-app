# Implementation Plan: Application Auto-Update

**Branch**: `013-auto-update` | **Date**: 2026-02-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/013-auto-update/spec.md`

## Summary

Add update awareness to the packaged app by **wrapping Electrobun's
built-in `Updater`** (vendored devkit SDK) rather than writing a custom
updater: launch + manual checks against a channel-scoped manifest feed,
background download with `tarSha256`-verified staging, and
restart-to-apply via the native helper handoff — all mapped onto one
typed RPC `UpdateView`. Channel selection (stable/canary) is a
persisted preference that picks which feed is checked; same-channel
updates apply in place, cross-channel transitions degrade to a guided
installer download because the devkit enforces
`channel == installed channel` end-to-end. The packaging workflow
publishes manifests + artifacts + changelog sidecars to a single
rolling `feed` GitHub Release. Update networking is the feature's only
network surface and is disableable via a setting + env kill-switch.

## Technical Context

**Language/Version**: TypeScript strict (Bun runtime main process, React 19 renderer)

**Primary Dependencies**: Electrobun 2.x devkit `Updater` (vendored,
`.hutch/devkit/api/sdks/main/core/Updater.ts`), `bun:ffi` native shim
(untouched), existing RPC layer (`defineElectrobunRPC`), settings store

**Storage**: two new persisted settings fields (`updates.enabled`,
`updates.channel`) via the existing versioned settings store; updater
staging/records live in the devkit-managed channel root
(`self-extraction/`) — we only read them through `Updater` APIs

**Testing**: `bun test` — unit tests for feed parsing/status mapping/
downgrade guard against fixture manifests; RPC contract tests
(dependency-injected `Updater`); manual end-to-end via loopback feed
(quickstart.md). CI gates: `tsc --noEmit`, oxlint, `bun test`.

**Target Platform**: packaged desktop — linux-x64 (verified today),
darwin-arm64/x64, win-x64 (packaging lanes configured)

**Project Type**: desktop application (Electrobun + Bun FFI)

**Performance Goals**: launch check non-blocking, completes < 5 s on a
normal connection (devkit fetch timeout is 30 s); downloads throttled
progress events; zero startup impact when disabled/offline

**Constraints**: local-first — update feed is the only permitted
network call (FR-010), documented + disableable; never force a
mid-session restart; private repo → feed needs public hosting or
public-asset URLs (ops decision, documented); no new dependencies
(devkit `Updater` is already vendored)

**Scale/Scope**: ~5 new source files + RPC contract extension +
settings UI section + one packaging-workflow publish step

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Evidence |
|---|---|---|
| llama.cpp via Bun FFI for inference | PASS | Feature does not touch inference |
| Electrobun owns shell + Bun main process | PASS | Updater is the Electrobun-native mechanism; main-process service wraps it |
| Typed RPC/IPC contracts | PASS | `UpdateView` + `update.*` requests/`update.status` message extend `ChatRpcSchema` (contracts/rpc.md) |
| TypeScript strict | PASS | all new code TS-strict; `UpdateView` typed end-to-end |
| React + Tailwind v4 + shadcn/ui | PASS | settings section + banner use existing ui primitives |
| Vite renderer pipeline | PASS | unchanged |
| New dependencies justified | PASS | **zero new dependencies** — updater, fetch, zstd staging all devkit/runtime-provided |
| Quality gates (`tsc`, lint, vite build, FFI tests) | PASS | unchanged; feature adds unit/RPC tests on top |
| Local-first | PASS (scoped exception) | feed fetch is the single network call, documented + disableable per FR-010; recorded in research.md D3/D7 |

**Post-Phase-1 re-check**: design confirmed the two flagged risks —
(1) private-repo feed auth resolved as an ops/config decision
(`release.baseUrl`, not code), (2) channel selection resolved via
preferred-channel feed + guided cross-channel install (D4). No
violations; no Complexity Tracking entries needed.

## Project Structure

### Documentation (this feature)

```text
specs/013-auto-update/
├── spec.md                # Feature spec (existing, Draft → ready)
├── plan.md                # This file
├── research.md            # Phase 0 — D1..D7 decisions
├── data-model.md          # UpdateView, ReleaseDescriptor, settings fields
├── contracts/
│   ├── rpc.md             # update.* requests, update.status message, error codes
│   └── feed.md            # manifest/notes/artifact URL + publisher contract
└── quickstart.md          # loopback-feed end-to-end verification
```

### Source Code (repository root)

```text
src/
├── bun/
│   ├── updater/
│   │   ├── service.ts        # UpdateService — orchestrates Updater; injectable for tests
│   │   ├── feed.ts           # manifest+notes fetch/validate for the *preferred* channel
│   │   └── status-map.ts     # devkit UpdateStatusEntry → UpdateView/status mapping
│   ├── rpc/handlers.ts       # add update.check|download|apply|state + updates settings
│   ├── index.ts              # wire UpdateService; launch check after window ready
│   └── store/settings.ts     # updates.enabled / updates.channel persistence
├── shared/
│   ├── rpc-contract.ts       # + UpdateView, error codes, settings fields
│   └── types.ts              # UpdateView, ReleaseDescriptor, UpdateStatus
└── renderer/src/features/
    ├── update/UpdateBanner.tsx   # discrete notice: version+notes, progress, restart
    └── settings/UpdatesSection.tsx # channel select, enabled toggle, check-now, status

tests/
├── bun/updater/
│   ├── feed.test.ts          # manifest validation, downgrade guard, notes fetch
│   └── status-map.test.ts    # devkit status → UpdateView mapping incl. error→code
└── rpc/update.test.ts        # contract: check/download/apply/state + disabled paths

.github/workflows/packaging.yml  # + feed publish step (manifest, artifact, notes → `feed` release)
electrobun.config.ts             # + release.baseUrl (env-overridable)
docs/                            # + updates.md — network surface, disable, feed layout (FR-010)
```

**Structure Decision**: a self-contained `src/bun/updater/` module keeps
all devkit-updater interaction behind `UpdateService` (dependency-
injected into RPC handlers, matching `createRpc`'s existing pattern).
Renderer gets a single `features/update/` banner + a Settings section,
consistent with how features 015/016/017 are organized. The feed
contract lives in the packaging workflow since publishing is CI-owned.

## Complexity Tracking

No constitution violations — section intentionally empty.
