# Feature Specification: Model-Call Output & Stats Panel

**Feature Branch**: `016-output-stats-panel`

**Created**: 2026-01-10

**Status**: Draft

**Input**: User description: "Output panel in the UI that displays the model
calls, token counts (sent, received), execution time, toggleable with a
switch button; output shown per model (tabs component), divided by roles
and personas."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Inspect per-call model metrics (Priority: P1)

A user wants to see what the model actually did: every generation call
listed with the model file that served it, prompt (sent) tokens,
completion (received) tokens, and wall-clock time — organized in tabs
per model, and within each tab subdivided by the role (default / planner /
executor / fallback) and the persona that was active.

**Why this priority**: Local inference cost is invisible today — the app
already measures `tokens`/`elapsedMs` per turn but throws the detail
away. Seeing per-call cost is the core observability this feature adds.

**Independent Test**: Send two messages in one conversation and one
fusion turn in another — the panel lists three calls under the right
model tabs, executor/planner sections, with plausible token/time values.

**Acceptance Scenarios**:

1. **Given** a completed turn, **When** the user opens the panel, **Then**
   an entry shows the serving model file, sent-token count,
   received-token count, elapsed time, and the turn's timestamp.
2. **Given** a fusion turn, **When** the panel renders, **Then** planner
   and executor appear as separate entries under each one's role group.
3. **Given** a conversation with a persona assigned, **When** its calls
   render, **Then** they appear under that persona's subdivision (or
   "no persona" when unset).
4. **Given** a turn served by a fallback model, **When** the panel
   renders, **Then** the entry is filed under the model that actually
   served it and marked as fallback.

---

### User Story 2 - Toggle the panel via switch (Priority: P2)

A switch control enables/disables the panel. When off, the panel is
hidden and collection pauses; when re-enabled, the panel returns and new
calls start appearing again.

**Why this priority**: Observability has a small ongoing cost (a record
per turn) and screen space — users need a kill switch that respects the
choice, persisted across restarts.

**Independent Test**: Flip the switch off — panel disappears and calls
made while off do not appear when it is switched back on.

**Acceptance Scenarios**:

1. **Given** the switch is off, **When** turns complete, **Then** no
   metric entries are recorded.
2. **Given** the switch toggled back on, **When** a new turn completes,
   **Then** it appears; the panel state survives an app restart.

---

### User Story 3 - Reset collected metrics (Priority: P3)

A clear button empties the collected call history so a user can measure
"from now" (e.g., after a model or settings change).

**Why this priority**: Convenience — cumulative history is fine without
it, but resetting makes comparisons trivial.

**Independent Test**: Generate entries, press clear — list empties and
the next call shows as entry #1.

**Acceptance Scenarios**:

1. **Given** recorded entries, **When** the user clears, **Then** the
   list is empty and subsequent calls record normally.

---

### Edge Cases

- Calls made while the switch is off leave no gap noise — they simply
  aren't recorded (no zero-entries).
- Very long sessions: the in-memory buffer is bounded; oldest entries
  drop silently past the cap.
- A turn that fails mid-generation records as an entry with an error
  flag and whatever tokens were produced (best-effort), not silently
  dropped.
- Fallback-served calls are filed under the *serving* model, tagged
  fallback — never under the unbound role's model.
- Persona renamed/deleted after calls: old entries keep the persona name
  captured at call time.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST record one metrics entry per generation
  call: serving model file, prompt tokens sent, completion tokens
  received, elapsed milliseconds, timestamp, conversation, and status.
- **FR-002**: Token counts MUST be the actual counts observed by the
  engine (prompt tokens tokenized, tokens generated) — not estimates.
- **FR-003**: Fusion turns MUST produce one entry per phase, each tagged
  with its role (`planner`/`executor`) and the model that served it.
- **FR-004**: Entries MUST capture the active tag and persona name at
  call time; fallback entries MUST record the serving model and a
  fallback marker.
- **FR-005**: A switch MUST toggle the panel's visibility and the
  collection of new entries; the toggle state MUST persist across
  restarts.
- **FR-006**: The panel MUST present entries in tabs keyed by model file,
  subdivided by role and persona within each tab.
- **FR-007**: The metrics buffer MUST be bounded (≈500 entries,
  oldest-dropped) and session-scoped — no persistence required.
- **FR-008**: A clear action MUST empty the buffer via typed RPC.
- **FR-009**: All metrics collection and storage MUST live in the main
  process; the renderer receives snapshots via typed RPC only.

### Key Entities

- **Metric entry**: `{ id, ts, conversationId, modelFile, roleKey,
  tag?, personaName?, promptTokens, outputTokens, elapsedMs, warm,
  status, fallback? }`.
- **Panel setting**: `settings.outputPanel: boolean` — switch state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every completed generation produces a panel entry within
  1 second of completion.
- **SC-002**: Reported sent/received tokens match engine-reported counts
  exactly for 100% of entries.
- **SC-003**: Toggling the switch off stops recording (0 entries while
  off) and the choice survives restart.
- **SC-004**: The panel renders 500 entries without blocking the chat UI.
- **SC-005**: All existing gates pass and no pre-existing test regresses.

## Assumptions

- Metrics are session-scoped (in-memory); persisted analytics are out of
  scope.
- Token counting is already exact at the engine boundary (feature 003's
  `TurnStats` plumbing) — this feature surfaces it, not re-derives it.
- "Per model" means the model file that served the call, not the bound
  role/tag name.
