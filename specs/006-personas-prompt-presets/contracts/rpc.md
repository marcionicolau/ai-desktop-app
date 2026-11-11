# Contract Delta — 006-personas-prompt-presets

## Requests

### `persona.list` → `{ personas: Persona[] }`
Seeds starters on first call when unset. Includes a per-persona
`inUse` count? No — keep the shape plain; `persona.usage` answers
that on demand.

### `persona.upsert` `{ persona: Persona }` → `{ persona: Persona }`
Create or update by name. Errors: `INVALID_PARAMS` (bad slug, empty
or >8 KiB systemPrompt, bad params, unknown preferredTag).

### `persona.delete` `{ name }` → `{ cleared: number }`
Removes the persona and clears `personaName` on every referencing
conversation; `cleared` = conversations touched. `NOT_FOUND` when
the name doesn't exist.

### `persona.usage` `{ name }` → `{ count: number; titles: string[] }`
For delete-confirmation UI.

### `snippet.list` → `{ snippets: Snippet[] }`
### `snippet.upsert` `{ snippet: Snippet }` → `{ snippet: Snippet }`
`INVALID_PARAMS` on bad slug, empty text, or name colliding with a
persona.
### `snippet.delete` `{ name }` → `{ deleted: boolean }`

### `conversation.setPersona` `{ conversationId, personaName | null }`
→ `{ suggestedTag?: string }`
Assign/clear the conversation's persona. `NOT_FOUND` for unknown
conversation or persona name. `suggestedTag` = the persona's
`preferredTag` when set and different from the current selection —
the UI *offers* to apply it; nothing is rebound automatically
(FR-002).

## Type additions (shared/types.ts)

`Persona`, `Snippet`; `Conversation.personaName?: string | null`;
`ConversationSummary.personaName?: string | null`;
`Settings.personas: Persona[]`; `Settings.snippets: Snippet[]`.

## Behavior changes

- `chat.send`/`chat.regenerate`/`chat.edit` resolve the assigned
  persona: system prompt into `buildPrompt` (always-kept first turn,
  budgeted) and params into the `DEFAULT < global < persona <
  modelOverride < tag` merge. Fusion: system + params reach the
  executor only.
- `chat.warning` `CONTEXT_TRUNCATED` also fires when the system turn
  itself is truncated.
