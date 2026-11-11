# Feature Specification: Personas & Prompt Presets

**Feature Branch**: `006-personas-prompt-presets`

**Created**: 2025-11-24

**Status**: Draft

**Input**: User description: "Saved personas/prompt presets — {name, systemPrompt, generationParams, preferredTag} applied per conversation; slash-command quick insert of reusable prompt snippets."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Saved persona applied to a conversation (Priority: P1)

A user defines a persona — a named bundle of a system prompt plus
generation parameters and an optional preferred model tag — then applies
it to a conversation. Every turn in that conversation is then steered by
the persona's system prompt and parameters.

**Why this priority**: Users repeat the same steering instructions
constantly (tone, format, domain). A saved persona eliminates that
repetition and makes conversations self-describing.

**Independent Test**: Create persona "Concise tutor", apply it to a new
conversation, send a message — the answer reflects the persona's
instructions and uses its parameters.

**Acceptance Scenarios**:

1. **Given** a saved persona, **When** the user assigns it to a
   conversation, **Then** subsequent turns use its system prompt and
   generation parameters.
2. **Given** a conversation with an assigned persona, **When** the user
   removes the assignment, **Then** subsequent turns revert to default
   behavior while prior messages stay unchanged.
3. **Given** two conversations with different personas, **When** switching
   between them, **Then** each keeps its own persona and the active
   persona is visibly indicated.

---

### User Story 2 - Persona management (Priority: P2)

The user creates, edits, duplicates, and deletes personas from a dedicated
management surface, with validation and a sensible built-in starter set.

**Why this priority**: Management is required for P1 to be usable beyond a
single hardcoded preset, but the feature delivers value even with just
create/apply.

**Independent Test**: Create a persona, edit its instructions, duplicate
it, delete the copy — each operation persists and reflects in the picker.

**Acceptance Scenarios**:

1. **Given** the persona list, **When** the user creates one with a name,
   system prompt, and parameter overrides, **Then** it persists across
   restart and appears in the picker.
2. **Given** a persona assigned to conversations, **When** the user deletes
   it, **Then** those conversations keep working with default behavior and
   the deletion names the affected conversations (or asks confirmation).

---

### User Story 3 - Prompt snippet quick-insert (Priority: P3)

The user saves reusable prompt fragments and inserts them into the
composer via a `/name` slash-command picker — e.g. `/summarize` expands a
canned instruction before sending.

**Why this priority**: Power-user convenience on top of personas; the
composer remains fully usable without it.

**Independent Test**: Save a snippet, type `/` + its name in the composer,
select it — the text is inserted and sent as part of the message.

**Acceptance Scenarios**:

1. **Given** saved snippets, **When** the user types `/`, **Then** a
   filtered picker lists matching snippets and selection inserts the
   fragment at the cursor.

---

### Edge Cases

- Persona parameters vs tag parameters: precedence order must be explicit
  and documented (persona wins over global defaults, tag overrides win
  over persona — consistent with the existing cascade).
- Deleting a persona that is assigned: conversations must not break.
- Persona on a fusion conversation: the system prompt applies to the
  executor phase; the planner keeps its own planning directive.
- Empty/oversized system prompts are validated with a clear error.
- Snippet names must not collide with persona names in the picker.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to create, edit, duplicate, and delete
  named personas containing a system prompt and optional generation
  parameter overrides.
- **FR-002**: A persona MAY declare a preferred model tag; applying it
  offers to re-bind the conversation's active role selection.
- **FR-003**: Each conversation MUST allow zero or one assigned persona,
  changeable at any time without altering existing messages.
- **FR-004**: The persona's system prompt MUST be prepended to every turn
  of that conversation and MUST count against the prompt budget.
- **FR-005**: Persona parameter overrides MUST take precedence over global
  defaults and yield to per-tag overrides, per the existing cascade.
- **FR-006**: The active persona MUST be visibly indicated per conversation.
- **FR-007**: Personas and assignments MUST persist across restarts.
- **FR-008**: Users MUST be able to save reusable prompt snippets and
  insert them via a `/`-triggered picker in the composer.
- **FR-009**: In fusion conversations, the persona system prompt MUST apply
  to the executor phase only.
- **FR-010**: Persona CRUD and assignment MUST be exposed through typed
  RPC, consistent with existing contract conventions.

### Key Entities

- **Persona**: `{ name, systemPrompt, params (partial GenerationParams),
  preferredTag? }` — a reusable steering bundle.
- **Snippet**: `{ name, text }` — an insertable prompt fragment.
- **Assignment**: conversation → persona reference (nullable).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can create and apply a persona to a new conversation
  in under 30 seconds.
- **SC-002**: A turn under an assigned persona reflects its system prompt
  observably (e.g. enforced format appears in the answer).
- **SC-003**: Personas and per-conversation assignments survive restart
  with zero loss.
- **SC-004**: Conversations referencing a deleted persona continue to send
  and receive without errors.
- **SC-005**: All existing gates pass and no pre-existing test regresses.

## Assumptions

- One persona per conversation (not stacking).
- Built-in starter personas ship as seeded entries the user can edit or
  delete.
- Snippets are global, not per-conversation.
