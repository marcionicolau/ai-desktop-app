# Feature Specification: Startup Model Selection

**Feature Branch**: `018-startup-model-select`

**Created**: 2026-11-14

**Status**: Draft

**Input**: User description: "from ChatPage.tsx when the application startup the first time, does not show to select the model, this must came from model selection (default model setuped)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - First-Launch Model Prompt (Priority: P1)

A user opens the application for the first time (or on any launch where no
default model has ever been configured). Instead of a passive "no model is
loaded" banner that leaves the user hunting for the picker, the app
immediately presents the model-selection flow so the user can pick (or
download) a model file and start chatting. Once the user makes a choice it
becomes the default model and subsequent launches load it automatically.

**Why this priority**: This is the entire feature. Without it the feature
delivers nothing; with it the first-run dead-end is eliminated.

**Independent Test**: Launch the app with a fresh/empty data directory (no
configured model) and observe the model-selection prompt appear without any
user action; pick a model and verify chatting works and the next launch
skips the prompt.

**Acceptance Scenarios**:

1. **Given** the app has no configured default model, **When** it finishes
   startup, **Then** the model-selection interface is presented
   automatically (no click required).
2. **Given** the prompt is showing, **When** the user picks an available
   model file, **Then** it is saved as the default model and normal chat
   behavior begins.
3. **Given** the app has a configured default model, **When** it starts,
   **Then** no prompt appears and the configured model loads as today.
4. **Given** the prompt is showing, **When** the user dismisses it without
   choosing, **Then** the existing "no model loaded" state remains and the
   user can still open the picker manually — no model is force-assigned.

---

### User Story 2 - No Models Available (Priority: P2)

A first-time user has no model files on disk at all. The startup
model-selection flow must still work: it shows the model library (including
the download path) so the user can obtain a model rather than hitting a
dead end.

**Why this priority**: Most first-run users in practice have no models yet;
a picker that only lists existing files would strand exactly the users this
feature targets.

**Independent Test**: Launch with an empty models directory — the presented
selection flow offers the library/download path, not an empty list.

**Acceptance Scenarios**:

1. **Given** no configured model and no model files on disk, **When** the
   startup prompt appears, **Then** it routes into the model library so a
   model can be downloaded/imported.
2. **Given** the library is empty, **When** the user downloads a model
   successfully, **Then** it becomes the default and the prompt resolves.

---

### Edge Cases

- A configured model file that has been deleted or moved: the startup flow
  should surface the selection prompt again rather than a silent error
  (consistent with "no usable default" = prompt).
- User dismisses the prompt: it must not re-appear on every app
  foreground/refresh — it is a startup-time affordance, not a modal loop.
- Model currently loading at startup (a stored default): the prompt must
  not flash over the loading state.
- Concurrent model-load failure at startup: the prompt appears alongside
  the error, letting the user pick a different model.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When no usable default model is configured at startup, the
  app MUST present the model-selection interface automatically after
  startup completes (no user click required).
- **FR-002**: Selecting a model in the startup prompt MUST persist it as
  the default model and transition to normal chat behavior, identical to
  choosing via the existing manual picker.
- **FR-003**: When a usable default model IS configured, startup MUST
  behave exactly as today — no prompt, model loads normally.
- **FR-004**: The startup prompt MUST be dismissible; dismissing leaves the
  existing no-model state intact and does not re-prompt within the same
  session.
- **FR-005**: When no model files exist, the prompt MUST offer the model
  library's download/import path rather than an empty selection list.
- **FR-006**: The prompt MUST NOT appear while a configured default model
  is actively loading.
- **FR-007**: A stored default whose file is missing/unreadable MUST be
  treated as "no usable model" and trigger the prompt.

### Key Entities

- **Default model**: the persisted model path the app loads at startup;
  "usable" means configured AND the file resolves.
- **Model library**: the existing list of model files plus download/import
  affordance used to obtain a model.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a fresh install/first launch, the user reaches a working
  chat-ready state in at most 2 actions (pick/download a model, done) —
  versus today where they must discover and click the picker.
- **SC-002**: 100% of launches with no usable model show the selection
  prompt automatically; 0% of launches with a usable model show it.
- **SC-003**: Users who dismiss the prompt can still reach the model
  picker in 1 action via the existing manual control.
- **SC-004**: No regression: with a valid configured model, startup time
  and chat behavior are unchanged.

## Assumptions

- "Model selection" means the existing model picker/library flow — this
  feature triggers it automatically; it does not create a new selection UI.
- A model "download" counts as making a selection (the downloaded model
  becomes the default).
- The prompt is startup-triggered only; mid-session model clearing/unload
  does not re-trigger it.
- The first-run check is based on the persisted default-model setting plus
  file resolution, not a separate "first launch" flag.
