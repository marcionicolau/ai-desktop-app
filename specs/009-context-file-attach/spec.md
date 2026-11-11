# Feature Specification: Attach Files as Turn Context

**Feature Branch**: `009-context-file-attach`

**Created**: 2025-11-24

**Status**: Draft

**Input**: User description: "Attach text/code files to a chat turn — content chunked into the prompt budget with visible file chips and per-message source list; graceful degradation when files exceed context."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Attach a file to a message (Priority: P1)

A user working on code picks one or more files, sees them as removable
chips above the composer, and sends a question. The model receives the
file contents alongside the message and answers with awareness of them.

**Why this priority**: "Explain/review this file" is the single most
common reason users leave a chat app for a text editor — in-context file
content removes that friction.

**Independent Test**: Attach a source file, ask "what does this do" — the
answer demonstrably reflects the file's actual content.

**Acceptance Scenarios**:

1. **Given** a .ts file attached, **When** the user sends a question about
   it, **Then** the answer references the file's real symbols/logic.
2. **Given** attached chips, **When** the user removes one before sending,
   **Then** only the remaining files are included.
3. **Given** a sent message with attachments, **When** viewing history,
   **Then** the message shows which files were included.

---

### User Story 2 - Oversized content handled gracefully (Priority: P2)

Attaching a file larger than the available context does not silently
truncate mid-symbol or fail opaquely: the user sees how much will be
included, and the system fits attachments into the budget predictably.

**Why this priority**: Silent context loss produces confidently wrong
answers — the user must know what the model actually saw.

**Independent Test**: Attach a file larger than the context budget — a
notice states it was truncated/summarized, and generation still succeeds.

**Acceptance Scenarios**:

1. **Given** an oversized attachment, **When** the user sends, **Then** a
   warning indicates the file was truncated and generation proceeds.
2. **Given** multiple attachments exceeding the budget, **When** sending,
   **Then** attachments are included in order until the budget is spent
   and the remainder is visibly excluded.

---

### Edge Cases

- Binary/unreadable files are rejected with a clear reason at attach
  time, not at send time.
- The same file attached twice is deduplicated.
- A file changed on disk between attach and send uses the content read
  at attach time (or re-reads consistently — must be deterministic).
- Attachments in fusion mode: files go to the executor phase context;
  the planner sees the request plus an attachment summary.
- Very long file paths/names truncate in chips without breaking layout.
- Attachments on regenerated turns reuse the originally attached content.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to attach one or more local text files to
  a draft message via a file picker.
- **FR-002**: Attachments MUST render as removable chips showing file name
  and size before sending.
- **FR-003**: Binary or undecodable files MUST be rejected at attach time
  with a human-readable reason.
- **FR-004**: Attachment content MUST be injected into the prompt within
  the existing context budget, ahead of history truncation.
- **FR-005**: When attachments exceed the budget, the system MUST visibly
  warn and either truncate (marked) or exclude excess files — never fail
  silently.
- **FR-006**: Sent messages MUST record which files were attached
  (names + sizes) and display them in history.
- **FR-007**: Re-attaching an already-attached file MUST deduplicate.
- **FR-008**: In fusion conversations, attachment content MUST reach the
  executor phase; the planner receives a list of file names and sizes.
- **FR-009**: Regenerated turns MUST reuse the original attachments.
- **FR-010**: All attachment handling MUST be fully local; file access
  MUST go through the main process (typed RPC), never the renderer.

### Key Entities

- **Attachment**: `{ id, fileName, path, sizeBytes, content }` — content
  captured at attach time.
- **Message attachment record**: ordered list of file names/sizes stored
  on the sent message.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can attach a file and get a content-aware answer in
  a single turn.
- **SC-002**: Attaching a file 10x the context budget still produces a
  successful turn with an explicit truncation warning.
- **SC-003**: Sent attachments are visible in history after restart.
- **SC-004**: Binary files are rejected 100% of the time before sending.
- **SC-005**: All existing gates pass and no pre-existing test regresses.

## Assumptions

- Text-like files only in v1 (code, markdown, logs, csv, json); PDF/docx
  extraction and embeddings/RAG are explicitly out of scope.
- Per-attachment and total-attachment size caps apply (defaults chosen
  in planning).
- Attachment content is read at attach time and stored with the draft.
