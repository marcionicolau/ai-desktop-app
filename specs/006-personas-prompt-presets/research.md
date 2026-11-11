# Research — 006-personas-prompt-presets

## D1 — Settings, not a new store

Personas and snippets are small named lists that fit the settings
JSON (`personas`, `snippets` fields). Bonus: the 008 backup/restore
already serializes `Settings`, so personas ride exports for free —
SC-003 with zero new IO code. `Conversation.personaName` persists
with the conversation (nullable, absent = unassigned).

## D2 — Seed-on-read (starter set)

`PersonaService.list()` materializes starter personas into settings
the first time it sees an unset `personas` array — mirrors how the
`default` role tag provisions itself (004). Starters are plain
entries: editable and deletable like user-created ones.

Seeds: `concise` ("Answer briefly and directly. Skip preamble."),
`tutor` ("Explain step by step like a patient tutor."), `coder`
("Respond with code first; minimal prose; match project
conventions.").

## D3 — preferredTag is a suggestion, not an override

FR-002: "applying it offers to re-bind". `conversation.setPersona`
returns `{suggestedTag?: string}` when the persona declares one —
the renderer shows an inline "switch to <tag>?" affordance that
routes through the existing mode/binding RPCs (single mode →
`model.load` on the tag's resolved path; fusion → `setMode` tag
picks). Never auto-mutates role bindings.

## D4 — Delete semantics

`persona.delete` clears `personaName` on every referencing
conversation and returns `{cleared: n}` — conversations degrade to
default behavior intact (SC-004). `persona.usage` reports
`{count, titles}` beforehand so the UI can name what's affected
(spec edge case alternative to a blind confirm).

## D5 — Validation

- `Persona.name`: `SLUG_RE` (same as role tags) + unique.
- `systemPrompt`: non-empty, ≤ 8 KiB.
- `params`: `validateParams` (existing validator, same as
  `settings.set` path); `null` = no overrides.
- `preferredTag`: must be an existing tag name.
- `Snippet.name`: same slug rules; unique across snippets **and**
  personas (they share the `/` picker namespace — spec edge case).

## Params cascade insertion (FR-005)

Existing: `DEFAULT < settings.generation < modelOverrides[file] <
tag.params` (roles.ts `paramsFor`; `resolveGenParams` drops the tag
layer when roles dep is absent).

New: `DEFAULT < global < persona < modelOverride < tag`.

`resolveCandidates(name, {personaParams})` inserts the merge between
`settings.generation` and `modelOverrides`; the legacy
`resolveGenParams` path gets the same middle layer. In fusion only
the executor candidates receive persona params (FR-009).

## Prompt injection (FR-004/FR-009)

`buildPrompt` gains `opts.system`: the system turn is selected first
(always kept — it's the whole point of a persona), then `current`,
then history backfills remaining budget. If the system turn alone
exceeds budget it's hard-truncated and `truncated` flags — same
`CONTEXT_TRUNCATED` warning channel. `render` gets a `system` arm:
ChatML emits a `system` im_start block; plain format emits
`System: <content>`. In fusion, `runFusionTurn` accepts `system?` and
injects it only into the executor's `buildPrompt` call — the planner
keeps `buildPlannerPrompt` as its sole directive (FR-009).

## Alternatives considered

- **Persona stack on send-time content** (prepend instructions to each
  user message): rejected — pollutes history and survives edits badly.
- **Per-conversation param overrides separate from persona**: YAGNI —
  persona already carries params; no second channel.
- **New personas.json file**: rejected — settings store covers it and
  export/import rides along for free.