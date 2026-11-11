# Feature Specification: Conversation Export & Import

**Feature Branch**: `008-export-import`

**Created**: 2025-11-24

**Status**: Draft

**Input**: User description: "Export conversations to Markdown/JSON and full backup/restore — portable archive format, machine-independent (no absolute paths), collision-safe import."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Export one conversation (Priority: P1)

A user wants to share or archive a conversation. From the conversation's
menu they export it — choosing a readable document format or a
machine-readable format — and get a file they can keep, email, or check
into notes.

**Why this priority**: Data portability is the baseline expectation for a
local-first app; users' conversations must never be trapped.

**Independent Test**: Export a conversation to each format, open the files
— the Markdown reads as a clean transcript and the JSON contains every
message with metadata.

**Acceptance Scenarios**:

1. **Given** a conversation with mixed user/assistant messages, **When**
   exported to Markdown, **Then** the file renders as a readable
   transcript preserving speaker order and code blocks.
2. **Given** the same conversation, **When** exported to JSON, **Then** the
   file contains all messages with roles, timestamps, status, stats, and
   phase metadata.
3. **Given** a fusion conversation, **When** exported, **Then** plan-phase
   content is included and marked as the plan artifact.

---

### User Story 2 - Import a conversation (Priority: P2)

A user receives or moves a JSON export onto this (or another) machine and
imports it. It appears as a new conversation without colliding with
existing ids or referencing machine-local paths.

**Why this priority**: Round-trip portability is what makes export
trustworthy; needed for backup/restore to be real.

**Independent Test**: Export JSON, delete the conversation, import the
file — the conversation is restored with all messages intact.

**Acceptance Scenarios**:

1. **Given** a valid export file, **When** the user imports it, **Then** a
   new conversation appears containing identical message content.
2. **Given** an export file whose id already exists locally, **When**
   imported, **Then** the system creates a distinct conversation rather
   than overwriting.
3. **Given** a malformed or wrong-version file, **When** imported,
   **Then** a typed error names the problem and nothing is written.

---

### User Story 3 - Full backup & restore (Priority: P3)

The user exports the entire library — all conversations, settings,
personas, and role/tag configuration — as one archive for migration or
disaster recovery, and restores it on a fresh install.

**Why this priority**: Full-state migration; valuable but less frequent
than per-conversation sharing.

**Independent Test**: Export full backup, wipe the data directory (or use
a fresh profile), import — conversations and configuration are restored.

**Acceptance Scenarios**:

1. **Given** a backup archive, **When** imported into a fresh install,
   **Then** conversations, settings, and tag configuration are restored.
2. **Given** a backup referencing model files absent on the new machine,
   **When** imported, **Then** affected tags show `broken`/`unbound`
   states rather than crashing, so the user can re-bind.

---

### Edge Cases

- Export of an in-progress conversation: exports messages in their
  terminal states; a generating turn is excluded or marked incomplete.
- Absolute model paths in stored data MUST NOT leak into export files
  (privacy + portability) — bindings export as file names/tag names.
- Import into an empty library: ids regenerate if collisions exist.
- Very large conversations: synchronous export is acceptable within the
  SC-002 envelope (500 messages &lt; 2 s); chunked export is deferred —
  only needed if backups grow to multi-MB.
- Import preserves message ordering, variants (if branching exists),
  and phase artifacts.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to export any single conversation to
  Markdown and to JSON.
- **FR-002**: The JSON export MUST include all messages with role,
  content, status, timestamps, stats, and phase artifacts.
- **FR-003**: Export files MUST NOT contain absolute file paths or other
  machine-local references; model bindings export as tag/file names.
- **FR-004**: Users MUST be able to import a JSON export, producing a new
  conversation with identical content.
- **FR-005**: Import MUST never overwrite an existing conversation —
  collisions produce a distinct imported conversation.
- **FR-006**: Malformed or incompatible import files MUST produce a typed
  error naming the problem, with zero partial writes.
- **FR-007**: Users MUST be able to export a full backup (conversations +
  settings + roles + personas when present) and restore it.
- **FR-008**: Restored tags referencing absent model files MUST degrade to
  `unbound`/`broken` states rather than failing the import.
- **FR-009**: Import/export MUST be exposed via typed RPC and local file
  pickers, consistent with existing conventions.
- **FR-010**: All export/import operations MUST be fully local — no
  network access.

### Key Entities

- **Export file (JSON)**: versioned envelope `{ formatVersion, app,
  exportedAt, conversations[], settings?, roles? }`.
- **Transcript (Markdown)**: human-readable rendering — speaker labels,
  fenced code preserved, plan blocks as collapsible sections.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Export → delete → import round-trip restores 100% of message
  content and metadata.
- **SC-002**: Exporting a 500-message conversation completes in under 2
  seconds.
- **SC-003**: A backup made on one machine restores on a fresh install
  with all conversations browsable.
- **SC-004**: Import of a corrupted file fails with a named error and
  leaves the store untouched.
- **SC-005**: All existing gates pass and no pre-existing test regresses.

## Assumptions

- Model files themselves are never exported (too large; users manage
  GGUFs separately).
- A single JSON format version is introduced now; future versions must
  remain importable.
- Markdown export is one-way (not importable).
