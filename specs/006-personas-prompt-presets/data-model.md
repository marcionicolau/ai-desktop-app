# Data Model — 006-personas-prompt-presets

## Entities

### Persona (in `Settings.personas`)

```ts
interface Persona {
  name: string;                        // slug, unique, SLUG_RE
  systemPrompt: string;                // non-empty, <= 8 KiB
  params: Partial<GenerationParams> | null; // overrides; null = none
  preferredTag?: string;               // must name an existing tag
}
```

### Snippet (in `Settings.snippets`)

```ts
interface Snippet {
  name: string;   // slug, unique across snippets AND personas
  text: string;   // non-empty; inserted verbatim at cursor
}
```

### Assignment (on `Conversation`)

```ts
personaName?: string | null;   // 0 or 1 persona; absent = unassigned
```

`ConversationSummary` mirrors `personaName` for the sidebar badge
(FR-006).

## Relationships

- `Persona.preferredTag` → `ModelTag.name` (validated at upsert).
- `Conversation.personaName` → `Persona.name` (loose reference —
  deleted personas leave `null` after `persona.delete` cleanup).
- Seeded personas appear on first `persona.list` when
  `settings.personas` is unset; identical shape to user entries.

## Invariants

- One persona per conversation (spec assumption — no stacking).
- Params merge order: `DEFAULT < global < persona < modelOverride <
  tag` (FR-005).
- Deleting a persona never deletes or alters messages (SC-004).
- Snippets are global, not per-conversation.
