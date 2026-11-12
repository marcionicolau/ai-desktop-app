---
description: "Task list for 013-auto-update implementation"
---

# Tasks: Application Auto-Update

**Input**: Design documents from `specs/013-auto-update/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/rpc.md, contracts/feed.md, quickstart.md

**Tests**: Included — plan.md commits to unit + RPC contract tests (`tests/bun/updater/`, `tests/rpc/update.test.ts`). Write them first per repo convention (failing test → implement → green).

**Organization**: US1 (P1) delivers the full check→download→apply loop; US2 (P2) adds channel selection + verification trust surface. Both share the Foundational `UpdateService` core.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2)
- Include exact file paths in descriptions

## Path Conventions

- Bun main process: `src/bun/`, shared contracts: `src/shared/`, renderer: `src/renderer/src/features/`, tests: `tests/`
- Devkit updater API: `import { Updater } from "electrobun/main"` (vendored at `.hutch/devkit/api/sdks/main/core/Updater.ts`)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Module skeleton + build config the updater needs

- [X] T001 Create `src/bun/updater/` module skeleton (`service.ts`, `feed.ts`, `status-map.ts` stubs exporting the interfaces from data-model.md) and `tests/bun/updater/` + `tests/rpc/` directories
- [X] T002 Add `release: { baseUrl: process.env.UPDATE_FEED_BASE_URL ?? "<github releases feed URL>" }` to `electrobun.config.ts` so `version.json` carries the feed URL in packaged builds (see contracts/feed.md URL layout; use `releases/download/feed` as the production placeholder)
- [X] T003 [P] Add `UpdateView`, `ReleaseDescriptor`, and `UpdateStatus` types to `src/shared/types.ts` matching data-model.md exactly (`status: idle|checking|available|downloading|ready|error`; `channelSwitch?: boolean`; `progress?: { bytesDownloaded; totalBytes; percent }`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared contract + persistence + service core — no story works without these

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Extend `src/shared/rpc-contract.ts`: add `"UPDATE_INVALID"`, `"UPDATE_FAILED"`, `"UPDATE_DISABLED"` to `RPC_ERROR_CODES`; add `update.check`/`update.download`/`update.apply`/`update.state` requests to `bun.requests` and the `update.status: UpdateView` message to `webview.messages` (shapes per contracts/rpc.md); add `updates?: { enabled?: boolean; channel?: "stable" | "canary" }` to `settings.set` params and `updates: { enabled: boolean; channel: "stable" | "canary" }` to `settings.get` response
- [X] T005 Persist `updates.enabled` (default `true`) and `updates.channel` (default = installed channel) in `src/bun/store/` settings, honoring `AI_DESKTOP_APP_UPDATE=off` as an env override forcing `enabled=false` (FR-010); wire both fields through the `settings.get`/`settings.set` handlers in `src/bun/rpc/handlers.ts`
- [X] T006 Implement `status-map.ts`: pure function mapping devkit `UpdateStatusEntry.status` → `UpdateView.status` and deriving `error.code` (`UPDATE_INVALID` for artifact/manifest/disk failures, `UPDATE_FAILED` for transport) per the mapping table in data-model.md
- [X] T007 Implement `feed.ts`: `checkChannelFeed(preferredChannel, localInfo, fetchImpl?)` — builds `{baseUrl}/{preferred}-{os}-{arch}-update-v2.json` URL, fetches via injected fetch (timeout 5 s for launch checks), validates with the devkit `validateUpdateManifest` (`expected.channel = preferred`), requires `tarSha256`, applies the semver downgrade guard (manifest version must be `>=` installed version), and fetches the `{prefix}-notes.md` sidecar into `ReleaseDescriptor.changelog` (non-fatal on 404)

**Checkpoint**: Contract, settings, and feed layers compile — `bun run typecheck` clean

---

## Phase 3: User Story 1 - Update notification & apply (Priority: P1) 🎯 MVP

**Goal**: Launch + manual checks find newer same-channel releases, download in background with progress, verify via `tarSha256`, and apply on explicit restart

**Independent Test**: Point a packaged canary build at a loopback feed with a newer manifest (quickstart.md) → banner shows version + notes → download progresses → "Restart to update" relaunches on the new version

### Tests for User Story 1 ⚠️ write first, must FAIL

- [X] T008 [P] [US1] `tests/bun/updater/feed.test.ts` — fixture manifest/notes served via injected fetch: valid manifest parses into `ReleaseDescriptor`; missing `tarSha256` rejected; invalid JSON rejected; older-version manifest ignored (downgrade guard); notes 404 → empty changelog, not an error
- [X] T009 [P] [US1] `tests/bun/updater/status-map.test.ts` — every `UpdateStatusType` maps to the correct `UpdateView.status`; `error` entries with artifact/integrity messages → `UPDATE_INVALID`, transport messages → `UPDATE_FAILED`; `download-progress` details → `progress` fields
- [X] T010 [P] [US1] `tests/rpc/update.test.ts` — contract test with a stubbed `Updater` (dependency-injected like existing rpc tests): `update.check` returns `UpdateView`; `update.download`/`update.apply` are ack-only and delegate; `update.state` returns the snapshot; disabled/unsupported-channel requests → `UPDATE_DISABLED`/`idle` per contracts/rpc.md

### Implementation for User Story 1

- [X] T011 [US1] Implement `UpdateService` in `src/bun/updater/service.ts` — constructor takes `{ updater, localInfo, settings, emit }`; `check(manual)` calls `feed.checkChannelFeed` for the preferred channel, then delegates to `Updater.checkForUpdate()` when `preferred == installed` and a newer release exists (populates devkit's private manifest for download); subscribes `Updater.onStatusChange` → maps entries via `status-map` → emits `update.status`; launch-mode failures stay `idle`-silent (FR-007)
- [X] T012 [US1] Add `download()`/`apply()`/`state()` to `UpdateService` — `download()` no-ops unless `updateAvailable`, delegates to `Updater.downloadUpdate()`; `apply()` throws `UPDATE_FAILED` unless `updateReady`, delegates to `Updater.applyUpdate()`; all three short-circuit to `UPDATE_DISABLED` when `updates.enabled === false` or channel is `dev`
- [X] T013 [US1] Register the four `update.*` request handlers + `update.status` push in `src/bun/rpc/handlers.ts` and construct/wire `UpdateService` in `src/bun/index.ts`; fire the launch check fire-and-forget after first window ready (never blocks startup — SC-001)
- [X] T014 [P] [US1] Create `src/renderer/src/features/update/UpdateBanner.tsx` — discrete banner on `update.status`: shows `release.version` + changelog summary (render `changelog` markdown minimally), progress bar from `progress.percent`, and a "Restart to update" action calling `update.apply`; suppressed while a generation is active (apply still user-explicit — FR-005)
- [X] T015 [P] [US1] Create `src/renderer/src/features/settings/UpdatesSection.tsx` — "Updates" block in Settings: enabled toggle (`updates.enabled`), current version + installed channel (from `update.state`), "Check for updates" button (`update.check { manual: true }`), last-checked display; honors `UPDATE_DISABLED` with an explanatory note on dev builds
- [X] T016 [US1] Add feed publish to `.github/workflows/packaging.yml` release job — after existing artifact upload: `gh release upload feed artifacts/* --clobber` (create the rolling `feed` prerelease if absent) plus a step generating `{prefix}-notes.md` via `git log <prev-channel-tag>..<tag> --pretty=format:'- %s'` per contracts/feed.md publisher contract; keep assets unrenamed

**Checkpoint**: End-to-end loop works on the loopback feed (quickstart.md steps 1–4); US1 independently demonstrable

---

## Phase 4: User Story 2 - Channel selection & trust (Priority: P2)

**Goal**: User picks stable/canary feed; stable never offers canary artifacts; corrupted artifacts are refused with `UPDATE_INVALID`; cross-channel transitions degrade to guided install

**Independent Test**: On a canary build, select `stable` → the service checks the stable manifest only; corrupt a staged `.tar.zst` asset → refusal with `UPDATE_INVALID`, app stays on current version

### Tests for User Story 2 ⚠️ write first, must FAIL

- [X] T017 [P] [US2] Extend `tests/bun/updater/feed.test.ts` — preferred-channel isolation: requesting `stable` never surfaces a canary manifest (fixture serves both); manifest whose `channel` mismatches the requested prefix fails validation
- [X] T018 [P] [US2] Extend `tests/rpc/update.test.ts` — `preferred != installed` + newer release → `UpdateView.release` present with `channelSwitch: true`; `update.download` in that state returns `{ installerPath }` instead of calling `Updater.downloadUpdate`; corrupted-artifact stub → `UPDATE_INVALID` surfaced on `update.status`

### Implementation for User Story 2

- [X] T019 [US2] Add the channel selector to `UpdatesSection.tsx` — `stable|canary` radio/select writing `updates.channel` via `settings.set`; shows a "channel differs from installed build" hint when `preferred != installed`; `dev` is never selectable (FR-006)
- [X] T020 [US2] Implement cross-channel path in `src/bun/updater/service.ts` — when `preferred != installed` and the feed has a newer release, mark `UpdateView.channelSwitch = true`; `update.download` then downloads the packaged installer zip `{repo}/releases/download/v{manifest.version}/ai-desktop-app-{channel}-{os}-{arch}.zip` (contracts/feed.md "Installer assets") into the platform downloads dir and returns `{ installerPath }` — never invokes `Updater.downloadUpdate`/`applyUpdate` (devkit enforces `channel == installed`, see research.md D4)
- [X] T021 [US2] Surface `channelSwitch` in `UpdateBanner.tsx` — instead of the in-place download/apply actions, show "Switch to `<channel>` `<version>`" which triggers `update.download` then instructs to run the downloaded installer; document side-by-side channel dirs (`~/.local/share/<identifier>/<channel>/`) preserve user data (FR-009)

**Checkpoint**: Channel isolation + refusal verified; US1 and US2 both independently functional

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, verification, hardening

- [X] T022 [P] Create `docs/updates.md` — documents the single permitted network surface (feed fetch), the `updates.enabled` toggle + `AI_DESKTOP_APP_UPDATE=off` kill-switch, feed layout per contracts/feed.md, and the private-repo hosting caveat (FR-010)
- [X] T023 [P] Update `README.md` features/`AGENTS.md` module map with the updater module and its local-first exception note
- [ ] T024 Run the quickstart.md checklist end-to-end on linux-x64: newer release detected → download → restart applies; corrupted artifact refused; offline launch check silent; channel switch offers guided install
- [X] T025 Final gates: `bun run typecheck`, `bun run lint`, `bun test` — zero new warnings, all 395+ tests green (SC-005)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on T003 types — BLOCKS both stories
- **US1 (Phase 3)**: Depends on Foundational — the core loop
- **US2 (Phase 4)**: Depends on Foundational; reuses US1's service/banner but is independently testable (channel isolation + refusal don't need the apply path)
- **Polish (Phase 5)**: After desired stories complete

### User Story Dependencies

- **US1 (P1)**: No dependencies on US2 — delivers MVP alone
- **US2 (P2)**: Extends `UpdateService`/`UpdateBanner` from US1 but its acceptance (channel isolation, `UPDATE_INVALID` refusal) can be verified against feed fixtures without US1's UI

### Within Each User Story

- Tests (T008–T010, T017–T018) MUST fail before implementation
- `status-map`/`feed` (T006–T007) before `UpdateService` (T011–T012)
- Service before RPC wiring (T013) before UI (T014–T015)

### Parallel Opportunities

- T003 ∥ T002 (different files)
- T008 ∥ T009 ∥ T010 (three independent test files)
- T014 ∥ T015 (banner vs settings section — different files)
- T017 ∥ T018 (test files)
- T022 ∥ T023 (docs)

---

## Parallel Example: User Story 1

```bash
# Tests first, in parallel:
Task: "feed.test.ts — manifest validation + downgrade guard"
Task: "status-map.test.ts — devkit status → UpdateView mapping"
Task: "update.test.ts — RPC contract with stubbed Updater"

# Then UI in parallel after service+handlers land:
Task: "UpdateBanner.tsx — notice + progress + restart"
Task: "UpdatesSection.tsx — toggle + check-now + status"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + 2 → contract/settings/feed compile
2. Phase 3 → full check→download→apply loop on canary builds
3. **STOP and VALIDATE**: quickstart loopback feed test — this is already a shippable updater
4. US2 adds channel selection + guided cross-channel flow

### Incremental Delivery

1. Foundation → types, settings, feed layer
2. US1 → working updater (MVP)
3. US2 → channel preference + trust surface
4. Polish → docs + end-to-end verification

---

## Notes

- [P] tasks = different files, no dependencies
- Devkit `Updater` internals are private (`checkedManifest`, `loadPreparedUpdate`) — service must call `checkForUpdate` before `downloadUpdate` on the same-channel path; the preferred-channel feed check (T007) is the only place we fetch manifests ourselves
- `Updater.getLocalInfo()` caches `version.json` — read once at service construction
- Loopback `http://localhost` feeds are legal per `prepareNativeUpdate`'s HTTPS-or-loopback rule — that's the dev/test path; production must serve HTTPS
- `channel == installed` is enforced inside `validateUpdateManifest`/`validatePreparedUpdate` — do NOT attempt in-place cross-channel apply (research.md D4)
