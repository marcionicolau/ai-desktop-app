# Validation — 006-personas-prompt-presets

Automated evidence is in `tests/personas/service.test.ts`,
`tests/rpc/personas.test.ts`, and the `system turn` describe in
`tests/bun/prompt.test.ts` (14 + 10 + 4 tests, all passing — 205 total
suite-wide at this commit).

## VS-1 Apply a persona (P1)

- Seed-on-read: `settings.personas === undefined` → starters
  (concise/tutor/coder) materialize and persist; explicit `[]` stays
  empty — `seed-on-read` tests.
- `conversation.setPersona` assigns/unassigns (`personaName` round-trip),
  returns `suggestedTag` when the persona names a bound-role tag, and
  rejects unknown conv/persona with `NOT_FOUND` — `setPersona` tests.
- Injection: `chat.send` prepends the persona's system prompt
  (`System: …` plain / `im_start|system` ChatML) ahead of history —
  `system prompt injected` + prompt-builder system-turn tests.
- Cascade: `DEFAULT < global < persona < modelOverride < tag` —
  `persona params beat global`, `model override beats persona params`.
- UI: header `<select>` per conversation, sidebar `personaName` badge,
  `suggestedTag` offer banner (hidden for unbound tags; single →
  `model.load` on the resolved path, fusion → executor tag pick).
- Fusion: persona system prompt + params reach the executor phase only;
  the planner keeps `buildPlannerPrompt` (`executorSystem` in fusion.ts).

## VS-2 Manage personas (P2)

- CRUD persists in `settings.personas` (export/backup rides feature 008
  for free); a second handler over the same store sees upserts —
  `upsert persists` test.
- Duplicate = upsert a copy under a new slug (`tutor-copy` coexists) —
  `duplicate flow` test.
- `persona.usage` returns `{count, titles}` for the delete confirm;
  `persona.delete` clears `personaName` on referencing conversations and
  returns `{cleared}` — `delete clears assignment` (SC-004: the conv
  still generates with no system block).
- Validation: slug shape, non-empty ≤ 8 KiB systemPrompt, params via
  `validateParams`, `preferredTag` must resolve — `validation
  rejections`, `PersonaService > upsert validates`.

## VS-3 Snippets (P3)

- `snippet.upsert/list/delete` round-trip + update-in-place — `snippet
  round-trip` test.
- Persona/snippet name collision (shared `/` namespace) →
  `INVALID_PARAMS` — collision assertions in both suites.
- UI: `/`-at-caret opens a filtered picker (prefix match, ≤ 8 rows);
  arrows cycle, Enter inserts at the caret, Esc/blur dismisses —
  `Composer.tsx` `trackPick`/`insertSnippet` (manual; renderer has no
  DOM test harness).

## Error paths

- Empty/oversized `systemPrompt`, bad slug, out-of-range params,
  unresolvable `preferredTag` → `INVALID_PARAMS` — `validation
  rejections`.
- `setPersona` unknown conv/persona → `NOT_FOUND`; in-use delete
  reports `cleared` — `setPersona unknown conv/persona`,
  `persona.delete clears assignment`.

## Gates

- `bun test` — 205 pass / 0 fail (30 files).
- `bun run typecheck` (tsc --noEmit) — clean.
- `bun run lint` (oxlint) — no new findings; one `no-map-spread`
  warning in service.ts mirrors the same existing warning in roles.ts.
- `hutch run build` — renderer + native bundle (see T016 log).
