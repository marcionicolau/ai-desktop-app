# Feature Specification: KV-State Persistence (Instant Resume)

**Feature Branch**: `010-kv-state-persistence`

**Created**: 2025-11-24

**Status**: Draft

**Input**: User description: "Persist model KV state per conversation so reopening a conversation skips re-prefill — save/restore native state snapshots, invalidated on model/param changes, with bounded disk usage."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Resume a conversation without re-prefill (Priority: P1)

A user reopens a long conversation after restarting the app. Today the
model re-processes the entire history (prefill) before the first new
token. With KV persistence, the cached state is restored and generation
starts almost immediately.

**Why this priority**: Prefill cost grows with conversation length and is
the dominant latency on long sessions — eliminating it is the biggest
perceivable speedup available to this app.

**Independent Test**: On a conversation with a long history, restart the
app, send a message — time-to-first-token is drastically lower than a
cold prefill and the answer is contextually correct.

**Acceptance Scenarios**:

1. **Given** a conversation whose state was saved, **When** the user sends
   a new message after restart, **Then** generation starts without a full
   re-prefill and produces contextually correct output.
2. **Given** a saved state, **When** the underlying model file changed or
   the bound role/model differs, **Then** the snapshot is discarded
   silently and normal prefill occurs.

---

### User Story 2 - Bounded snapshot storage (Priority: P2)

Snapshots are large; the system caps how much disk they consume, evicts
least-recently-used snapshots beyond the cap, and lets the user see and
clear stored state.

**Why this priority**: Unbounded multi-GB snapshots per conversation is a
disk-usage footgun; bounds make the feature safe to leave on.

**Independent Test**: Set a small cap, generate snapshots for several
conversations — the oldest is evicted at the cap and disk stays bounded.

**Acceptance Scenarios**:

1. **Given** a configured storage cap, **When** snapshots exceed it,
   **Then** the least-recently-used snapshots are evicted automatically.
2. **Given** the settings surface, **When** the user views snapshot
   storage, **Then** they see usage and can clear all snapshots.

---

### Edge Cases

- Snapshot written mid-generation (crash): restore never produces a
  partially-consumed state — writes are atomic; torn files are discarded.
- Model file replaced (same name, different bytes): snapshot invalidated
  by fingerprint, never applied against the wrong weights.
- Fusion conversations: state is per-phase-model; restoring uses the
  bound model for each phase independently.
- Model registry eviction frees a slot: in-memory state may be saved to
  disk before eviction so a later acquire restores it.
- Corrupt snapshot file: load fails → fallback to prefill with no error
  surfaced beyond a debug-level notice.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST be able to serialize a conversation's
  decode state to disk at turn boundaries.
- **FR-002**: On reopening a conversation with a valid snapshot, the
  system MUST restore that state and skip the corresponding prefill.
- **FR-003**: Snapshots MUST be keyed to the model identity (path +
  content fingerprint); any mismatch silently discards the snapshot.
- **FR-004**: Snapshot writes MUST be atomic — a crash never yields a
  restorable partial state.
- **FR-005**: Snapshot storage MUST be size-capped with LRU eviction;
  the cap MUST be configurable.
- **FR-006**: The user MUST be able to view snapshot disk usage and clear
  all snapshots.
- **FR-007**: Fusion conversations MUST keep per-role snapshots resolved
  through each role's bound model.
- **FR-008**: Snapshot lifecycle MUST integrate with the model registry:
  evicting an in-memory slot offers its state for disk persistence.
- **FR-009**: A missing, stale, or corrupt snapshot MUST degrade to normal
  prefill with zero user-facing failure.
- **FR-010**: All snapshot I/O MUST occur in the main process via the
  native shim and typed RPC — never the renderer.

### Key Entities

- **Snapshot**: `{ conversationId, modelFingerprint, sizeBytes,
  updatedAt, blob }` — serialized decode state.
- **Snapshot policy**: `{ maxBytes, enabled }` in settings.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Resuming a 4k-token conversation after restart reduces
  time-to-first-token by at least 50% vs cold prefill.
- **SC-002**: Disk usage by snapshots never exceeds the configured cap.
- **SC-003**: A snapshot bound to a different model file is never applied
  (0 wrong-model restores).
- **SC-004**: Corrupt snapshots produce zero failed turns — always clean
  prefill fallback.
- **SC-005**: All existing gates pass and no pre-existing test regresses.

## Assumptions

- The underlying inference engine supports state save/restore (native
  symbols to be added in planning).
- Snapshots are best-effort accelerators, not correctness requirements.
- Per-conversation: at most one snapshot per role/model pair.
