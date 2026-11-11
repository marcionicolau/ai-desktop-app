# Feature Specification: Conversation Branching & Message Trees

**Feature Branch**: `005-conversation-branching`

**Created**: 2025-11-24

**Status**: Draft

**Input**: User description: "Conversation branching & message trees — edit/regenerate preserves alternates as sibling branches instead of overwriting; branch picker per message; active leaf per conversation."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Regenerate keeps alternate answers (Priority: P1)

A user regenerates an assistant answer they are not satisfied with. Today the
new answer replaces the old one permanently. With branching, both variants
are preserved and the user can flip between them with next/previous
controls on the message.

**Why this priority**: This is the core value — users currently lose
potentially better answers the moment they regenerate. Variant comparison
is a standard expectation in chat UIs.

**Independent Test**: Send a message, regenerate twice, then navigate
siblings — three variants exist, any can be shown, and the conversation
continues from the displayed variant.

**Acceptance Scenarios**:

1. **Given** a complete assistant message, **When** the user regenerates it,
   **Then** the new answer is stored as a sibling variant and shown, while
   the original remains reachable.
2. **Given** a message with 3 variants, **When** the user clicks
   previous/next, **Then** the displayed variant changes and a
   "2/3"-style indicator reflects position.
3. **Given** a displayed variant that is not the last one, **When** the user
   sends a follow-up message, **Then** the conversation continues from the
   displayed variant (history includes it, not its siblings).

---

### User Story 2 - Edit creates a branch (Priority: P2)

A user edits one of their own past messages. The original message and its
answer path are preserved as a branch; the edited message starts a new
branch with its own regenerated answer.

**Why this priority**: Editing is the second overwrite point; preserving
the original path lets users explore "what if I had asked differently"
without losing the original conversation.

**Independent Test**: Edit an early user message, verify the old answer path
is still reachable via branch navigation and the new path is active.

**Acceptance Scenarios**:

1. **Given** a user message with an answer below it, **When** the user edits
   and resends it, **Then** the conversation shows the edited version and
   its fresh answer, while the original pair is reachable as a branch.
2. **Given** a user message with 2 edit variants, **When** the user switches
   variants, **Then** everything below the message switches to that
   variant's sub-tree.

---

### User Story 3 - Branch overview navigation (Priority: P3)

For conversations that have diverged heavily, the user can see where
branches exist (which messages have variants) and jump between sibling
chains.

**Why this priority**: Nice-to-have orientation aid; the per-message
picker already covers the common case.

**Independent Test**: Create several branches, open the overview, verify
each branching point lists its variants with previews and click navigates.

**Acceptance Scenarios**:

1. **Given** a conversation with 3 branching points, **When** the user opens
   the overview, **Then** each point shows variant count and a content
   preview, and selecting one displays that variant.

---

### Edge Cases

- Regenerating while a variant is mid-generation (generating lock already
  prevents concurrent turns — must hold across branches).
- Fusion turns: each variant stores its own `phases.plan` content
  independently.
- Partial/failed variants are kept as variants in their terminal state.
- Deep conversations with many branches: storage stays bounded because
  only message records are duplicated, not file/model data.
- Deleting a conversation deletes all branches with it.
- Switching variants while a generation is running is blocked until the
  turn completes (single-flight invariant).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Regenerating an assistant message MUST preserve the prior
  answer as a sibling variant rather than overwriting it.
- **FR-002**: Editing a user message MUST create a sibling variant of that
  message, preserving the original variant's entire sub-tree.
- **FR-003**: Each message with variants MUST display previous/next
  navigation plus a positional indicator (e.g. "2/3").
- **FR-004**: Exactly one variant path per conversation MUST be designated
  the active leaf; sending a new message appends to the path that includes
  the displayed variants.
- **FR-005**: Conversation history sent to the model MUST consist of the
  active variant path only — sibling variants are never included.
- **FR-006**: Switching variants MUST be blocked while a generation is in
  progress.
- **FR-007**: Branch data MUST persist across app restarts.
- **FR-008**: Fusion-mode variants MUST retain their own per-variant plan
  phase content.
- **FR-009**: Variant navigation MUST preserve each variant's own status,
  timestamps, stats, and phase metadata.
- **FR-010**: Deleting a conversation MUST remove all of its branches.

### Key Entities

- **Variant**: One alternative content of a message at a given position;
  carries its own status, stats, phases, and sub-tree.
- **Branch point**: A message position where two or more variants exist.
- **Active leaf**: The selected variant path through the conversation —
  what the UI shows and what the model sees.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can regenerate an answer 3 times and still reach all 4
  variants (original + 3) without data loss.
- **SC-002**: Switching between two variants renders in under 100 ms on a
  1000-message conversation.
- **SC-003**: After editing a mid-conversation message, both the old and new
  conversation paths remain fully browsable and continuable.
- **SC-004**: Branch state survives an app restart with zero variant loss.
- **SC-005**: All existing gates pass (typecheck, lint, tests, builds) and
  no pre-existing test regresses.

## Assumptions

- Variants are a per-message concept; cross-message "bookmarks" are out of
  scope.
- Branch overview (US3) may be delivered as a lightweight variant list per
  branch point rather than a full tree visualization.
- Existing `chat.edit`/`chat.regenerate` semantics extend rather than
  change: a turn still produces one answer.
