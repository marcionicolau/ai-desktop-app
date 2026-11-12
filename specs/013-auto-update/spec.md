# Feature Specification: Application Auto-Update

**Feature Branch**: `013-auto-update`

**Created**: 2025-11-24

**Status**: Draft

**Input**: User description: "Auto-update via release channel — version check on launch + manual check, changelog display, verified download, restart-to-apply, channel selection (stable/canary), offline-friendly failure."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Update notification & apply (Priority: P1)

A user running an older build sees a discrete notice that an update is
available, can read what changed, downloads it in the background, and
applies it on next restart (or via a "restart now" action).

**Why this priority**: Users otherwise never learn of fixes; a reliable
update path is what makes the app maintainable in the field.

**Independent Test**: Point the app at a release feed containing a newer
version — the banner appears, download completes, restart applies the
new version.

**Acceptance Scenarios**:

1. **Given** a newer release on the configured channel, **When** the app
   launches (or the user clicks "check for updates"), **Then** an update
   notice shows version + changelog summary.
2. **Given** a downloaded update, **When** the user restarts (or chooses
   "restart now"), **Then** the new version runs.
3. **Given** no newer release or a failed check, **When** the check
   completes, **Then** the UI either reports "up to date" or stays silent
   — never a scary error for a transient failure.

---

### User Story 2 - Channel selection & trust (Priority: P2)

The user picks stable or canary; downloads are verified (signature or
checksum) before apply; a failed verification refuses the update with a
named error and the app stays on the current version.

**Why this priority**: Channel choice serves testers vs conservative
users; verification is the security boundary for shipping binaries.

**Independent Test**: Corrupt a staged update artifact — verification
fails, the update is refused, and the current version keeps running.

**Acceptance Scenarios**:

1. **Given** channel = stable, **When** checking, **Then** canary builds
   are never offered.
2. **Given** a corrupted/mismatched artifact, **When** verified, **Then**
   apply is refused with a named error and the app remains functional.

---

### Edge Cases

- No network / fully offline machine: checks fail quietly; app behaves
  exactly as today (update is opportunistic, not blocking).
- Partial/interrupted download resumes or restarts cleanly; `.part`
  artifacts are never applied.
- Update available while a generation runs: download proceeds but apply
  waits for user action — never force-restarts mid-turn.
- User data (conversations, models, settings) is untouched by update —
  migration concerns belong to the versioned store schema, not updater.
- Downgrade attempts (feed older than installed) are ignored.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST check a configured release feed for a newer
  version on launch and on manual request.
- **FR-002**: When a newer version exists, the app MUST show version and
  changelog summary with download/apply actions.
- **FR-003**: Downloads MUST occur in the background with visible
  progress and resumable/clean failure semantics.
- **FR-004**: Update artifacts MUST be verified (signature/checksum)
  before apply; failure refuses apply with a named error.
- **FR-005**: Apply MUST require an explicit user restart or
  restart-on-quit — never a forced mid-session restart.
- **FR-006**: Users MUST be able to select release channel (stable /
  canary) and see the current version + channel.
- **FR-007**: Failed checks MUST degrade silently to current-version
  behavior — update is opportunistic.
- **FR-008**: Interruption MUST never apply a partial artifact.
- **FR-009**: User data MUST be unaffected by update operations.
- **FR-010**: Update networking is the ONLY permitted network call of
  this feature and MUST be documented and disableable.

### Key Entities

- **Release descriptor**: `{ version, channel, artifactUrl, checksum/
  signature, changelog, publishedAt }`.
- **Update state**: `{ status: idle|checking|available|downloading|
  ready|error, release? }`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Version check completes in under 5 seconds on a normal
  connection and never blocks app startup.
- **SC-002**: A valid update applies correctly end-to-end in the
  supported-channel test environment.
- **SC-003**: 100% of corrupted artifacts are refused at verification.
- **SC-004**: On a fully offline machine, all app features behave
  identically to a build without the feature.
- **SC-005**: All existing gates pass and no pre-existing test regresses.

## Assumptions

- A release feed/host exists (e.g. project releases page); exact hosting
  is decided in planning.
- Native libraries ship inside the packaged artifact — no separate
  native-update path in v1.
- Models/roles/user data are never part of the update payload.
