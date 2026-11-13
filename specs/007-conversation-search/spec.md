# Feature Specification: Cross-Conversation Search

**Feature Branch**: `007-conversation-search`

**Created**: 2025-11-24

**Amended (feature 026)**: the sidebar search box described below was replaced by the command palette (`Ctrl/Cmd+K`), which keeps title filtering, message-content search (≥ 3 characters, debounced), highlighted snippets and jump-to-message. Requirements about the search *behavior* still hold; those that name the sidebar box now refer to the palette.

**Status**: Draft

**Input**: User description: "Full-text search across all conversations — titles and message content; results grouped by conversation; jump to the matching message."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find past answers by content (Priority: P1)

A user remembers an answer contained a specific term but not which
conversation held it. They type the term into a sidebar search box and get
a result list grouped by conversation, showing title, matching snippet,
and date. Selecting a result opens that conversation scrolled to the
matching message.

**Why this priority**: Conversation history is the app's memory — without
search it becomes write-only after a few dozen conversations.

**Independent Test**: Create two conversations with distinct terms, search
one term — only the right conversation surfaces, with a snippet proving
the match, and clicking navigates to the exact message.

**Acceptance Scenarios**:

1. **Given** several conversations, **When** the user searches a term that
   appears in a message body, **Then** results show the conversation title
   plus a highlighted context snippet.
2. **Given** a result list, **When** the user selects a hit, **Then** that
   conversation opens scrolled to the matching message with the match
   highlighted.
3. **Given** a search term matching a title only, **When** searching,
   **Then** the conversation appears as a result even with no body match.

---

### User Story 2 - Filtered/incremental search UX (Priority: P2)

Search updates as the user types with a small debounce; a minimum query
length prevents noise; empty states explain what was searched.

**Why this priority**: Responsiveness and predictability — but a
submit-to-search interaction still satisfies P1.

**Independent Test**: Type a 4-letter query, watch results refine per
keystroke; clear to return to the normal sidebar.

**Acceptance Scenarios**:

1. **Given** the search box, **When** the user types ≥3 characters,
   **Then** results refresh without an explicit submit.
2. **Given** no matches, **When** results render, **Then** a clear "no
   results" state names the query.

---

### Edge Cases

- Very large archives (thousands of messages): results stay fast and
  ranked by recency.
- Searching while a message is mid-generation: the partial message is
  excluded until it completes.
- Deleted conversations disappear from results immediately.
- Search terms inside code blocks / plan-phase content (fusion):
  plan content is searchable like answer content.
- Special characters in the query are handled literally, not as query
  syntax errors.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST index every persisted message's content and
  every conversation title for search.
- **FR-002**: Search MUST be case-insensitive and match literal substrings;
  multi-word queries match messages containing all terms.
- **FR-003**: Results MUST be grouped by conversation and ordered by most
  recent conversation activity first.
- **FR-004**: Each result MUST show conversation title, a contextual
  snippet with the match highlighted, and message timestamp.
- **FR-005**: Selecting a result MUST open that conversation and scroll to
  the matching message.
- **FR-006**: The index MUST update as messages are added, edited,
  regenerated, or deleted — including after variant switches if branching
  exists.
- **FR-007**: Plan-phase content of fusion messages MUST be searchable.
- **FR-008**: The index MUST persist across restarts or rebuild
  transparently without user action and without data loss.
- **FR-009**: In-flight (status `generating`) messages MUST be excluded
  from results until they reach a terminal state.
- **FR-010**: Search MUST be fully local — no data leaves the device.

### Key Entities

- **Index entry**: `{ conversationId, messageId, content, timestamp }` —
  the searchable unit.
- **Search result**: conversation + ordered matching messages with
  snippets.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Search over 1,000 stored messages returns results in under
  300 ms on a typical desktop.
- **SC-002**: A user finds a known past answer via one query in under
  20 seconds.
- **SC-003**: A message sent and completed is searchable within 2 seconds
  of completion.
- **SC-004**: Index survives restart — search works immediately after
  relaunch with no re-index wait perceptible to the user.
- **SC-005**: All existing gates pass and no pre-existing test regresses.

## Assumptions

- Results are capped (e.g. top 20 conversations) — full-archive browsing
  is out of scope.
- No boolean/field query syntax in v1 — literal terms only.
- Search covers stored conversations only, not personas/roles/models.
