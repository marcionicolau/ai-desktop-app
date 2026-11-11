# Data Model: Desktop AI Chat

Derived from Key Entities in `spec.md`. Storage is local-only (JSON document
store in the OS user-data directory — see Storage in plan.md).

## Entities

### Conversation

| Field | Type | Rules |
|-------|------|-------|
| `id` | string (UUID) | unique, immutable |
| `title` | string | default derived from first user message (truncated); user-renamable |
| `createdAt` | ISO 8601 timestamp | set at first message or explicit creation |
| `updatedAt` | ISO 8601 timestamp | bumped on every message append |
| `messages` | ordered list of Message | order = append order; never reordered |

Relationships: contains 0..n Messages. Deleted as a unit (confirmation required,
then messages removed with it — FR-005).

### Message

| Field | Type | Rules |
|-------|------|-------|
| `id` | string (UUID) | unique |
| `conversationId` | string (UUID) | FK → Conversation |
| `role` | `"user" \| "assistant"` | |
| `content` | string | user messages: non-empty after trim (FR edge case) |
| `status` | `"generating" \| "complete" \| "partial" \| "failed"` | `generating` = in-flight stream; `partial` = user-stopped or crash mid-generation; `failed` = inference error |
| `createdAt` | ISO 8601 timestamp | |
| `completedAt` | ISO 8601 timestamp \| null | null while `generating` |

State transitions: assistant message created `status="generating"` →
`"complete"` on stream end; `"partial"` if stopped or still in-flight at
crash (restored as `"partial"` on relaunch); `"failed"` on inference error
(content retains whatever was generated).

### Model

| Field | Type | Rules |
|-------|------|-------|
| `path` | absolute path | must exist, be readable, and be a compatible model file |
| `name` | string | display name (defaults to filename) |
| `status` | `"unloaded" \| "loading" \| "ready" \| "error"` | exactly one model `ready` at a time |
| `error` | string \| null | human-readable message when `status="error"` |

State transitions: `unloaded → loading → ready | error`. `ready → loading` on
model switch (previous model unloaded first). Not persisted as an entity —
only `path`/`name` survive restart in settings; status always starts
`unloaded` on launch.

### Settings (implicit, from assumptions)

| Field | Type | Rules |
|-------|------|-------|
| `activeModelPath` | string \| null | restored on launch; does not auto-load |
| `contextLimitWarning` | boolean | whether FR-011 warning was acknowledged for the session |

## Validation rules (traceable to requirements)

- Empty/whitespace-only user messages rejected before send (edge case → FR-001).
- At most one assistant message in `generating` state per conversation
  at a time (FR-012).
- `Model.path` validated at load: file exists, extension/format check, load
  attempt reports progress (FR-006/FR-007).
- Conversation `title` non-empty; auto-generated if user clears it.
