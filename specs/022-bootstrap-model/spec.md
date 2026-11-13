# Feature Specification: First-Run Model Bootstrap

**Feature Branch**: `022-bootstrap-model`

**Created**: 2026-11-13

**Status**: Draft

**Input**: Issue #28 — auto-download a small default GGUF into `modelsDir()` on first run when no usable model is configured, with progress over RPC and fallback to the model library.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - First launch just works (Priority: P1)

A user installs the app, opens it for the first time, and — without hunting
through the model library — watches a small default model download with
visible progress, after which they land in a ready-to-use chat.

**Why this priority**: The whole feature. Today's first run dead-ends in a
library picker; automatic provisioning is the difference between "works out
of the box" and "configure before use".

**Independent Test**: Launch with a fresh/empty data directory → the
download starts automatically with progress shown → finishes → the model
becomes the default and chat accepts a message.

**Acceptance Scenarios**:

1. **Given** no usable chat model and no configured default, **When** the
   app finishes startup, **Then** a default model download begins
   automatically with a visible progress state.
2. **Given** the download completes, **When** the model file lands,
   **Then** it is set as the default model and loaded without further user
   action.
3. **Given** the download finished in a previous run, **When** the app
   launches again, **Then** no download repeats and the configured model
   loads normally.
4. **Given** a user-configured default model exists, **When** the app
   launches, **Then** bootstrap does nothing — the user's choice is never
   clobbered.

---

### User Story 2 - Failure & offline fallback (Priority: P2)

When the download can't start or fails (offline, blocked URL, disk error),
the user sees a clear setup state with a retry action — and can always fall
back to the manual model library instead of being stuck.

**Why this priority**: Networks fail; first impressions shouldn't. A retry
path plus the existing library flow keeps the app usable in every
environment.

**Independent Test**: Disconnect the network, launch fresh → an error
state with retry appears → choosing "browse models" opens the existing
library → reconnect and retry → download completes.

**Acceptance Scenarios**:

1. **Given** no network connectivity, **When** bootstrap runs, **Then**
   the UI shows an error with a retry action and a way into the manual
   model library.
2. **Given** a failed attempt, **When** the user retries, **Then** the
   download restarts cleanly (no partial file reused as a model).
3. **Given** bootstrap errors, **When** the user picks the manual path,
   **Then** the existing model library opens and works as today.

---

### Edge Cases

- Download interrupted mid-file → on next run the partial file is not
  treated as a usable model; download restarts from scratch.
- User closes the app mid-download → next launch re-evaluates and
  re-downloads (idempotent, no stuck state).
- A non-default model exists but none is bound as default → bootstrap
  still runs only when nothing *usable* is configured (see Assumptions).
- Bootstrap download must not start while the user is already downloading
  a model manually.
- Model file deleted after being bound → next launch falls back to the
  "no usable model" path (bootstrap or library prompt, same rules).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On startup, when no usable chat model exists or is
  configured, the app MUST begin downloading a small default chat model
  automatically — no user action required.
- **FR-002**: Bootstrap progress MUST be observable by the UI (phase +
  bytes downloaded/total) so progress can be rendered.
- **FR-003**: On successful download the app MUST set the model as the
  default and load it so the user can chat immediately.
- **FR-004**: Bootstrap MUST be idempotent — never re-download while a
  usable model exists, and never overwrite a user-configured default.
- **FR-005**: Download MUST reuse the existing download rules: source
  allowlist, write-then-rename (`.part`) semantics, and integrity of the
  final file; a partial download MUST never be treated as usable.
- **FR-006**: On failure the UI MUST surface an error state with retry,
  plus a path to the manual model library (the current first-run
  behavior).
- **FR-007**: Bootstrap MUST NOT run concurrently with a user-initiated
  model download.
- **FR-008**: The bootstrap state MUST be queryable and re-triggerable via
  the typed contract layer (no ad-hoc channel), so the renderer can show
  the setup screen on demand.
- **FR-009**: All network use is limited to fetching the model file
  itself — no telemetry, no extra calls (consistent with the app's
  offline posture).

### Key Entities

- **Setup state**: `{ phase, downloadedBytes, totalBytes, error? }` —
  `phase` ∈ `idle | checking | downloading | loading | done | error`;
  in-memory, queryable, evented to the renderer.
- **Bootstrap policy**: the default model's source + file name + expected
  size — a fixed constant (not user-editable); overridable for tests.
- **Usable model**: an existing file under the models dir that the
  library scan surfaces, or a bound `activeModelPath` whose file exists.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Fresh install → user can send their first chat message
  after bootstrap without any model-management interaction.
- **SC-002**: Bootstrap completes on a typical home connection within a
  few minutes (default model chosen small enough for that to hold).
- **SC-003**: Offline first launch still reaches a usable model-library
  path (no dead-end), verified by disconnecting the network.
- **SC-004**: No scenario produces a duplicate download or a clobbered
  user default (verified by repeated launches and pre-seeded models).
- **SC-005**: All existing gates pass; no pre-existing test regresses.

## Assumptions

- "Usable model" means a chat-model file present in the models dir OR a
  bound `activeModelPath` whose file still exists — matching the existing
  "no usable default" trigger that opens the library (feature 018).
- The default model is a small instruct GGUF from the existing HF
  allowlist; the exact file is an implementation-time choice recorded in
  a constant (a few hundred MB class, not GB-class).
- The existing feature-018 "auto-open the library" remains the fallback
  UI for the error path; bootstrap progress supersedes it while a
  download is healthy.
- Speech models (feature 014) are out of scope — this is chat models only.
