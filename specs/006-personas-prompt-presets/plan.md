# Implementation Plan: Personas & Prompt Presets

**Branch**: `006-personas-prompt-presets` | **Spec**: [spec.md](spec.md)
**Status**: Ready for tasks

## Summary

Saved personas `{name, systemPrompt, params, preferredTag?}` assignable
per conversation (0 or 1), injected as a system turn ahead of every
generation and merged into the params cascade between global defaults
and per-model/tag overrides — plus reusable `/`-triggered prompt
snippets in the composer. All state persists via the existing settings
store; all ops ride typed RPC.

## Technical Context

- **Storage**: `Settings.personas: Persona[]` + `Settings.snippets:
  Snippet[]` (settings store already migrates unknown fields on read —
  seed starter personas when the array is absent).
  `Conversation.personaName?: string | null`.
- **Prompt**: `buildPrompt` gains `opts.system?: string` → prepends a
  `role: "system"` turn that is *always* kept and counts against the
  budget first (FR-004); `render` gains a `system` arm for both ChatML
  and plain formats.
- **Params cascade**: existing order `DEFAULT < global < modelOverride
  < tag` becomes `DEFAULT < global < persona < modelOverride < tag`
  (FR-005) via `resolveCandidates(tag, {personaParams})` and
  `resolveGenParams` in handlers.
- **Fusion** (FR-009): `runFusionTurn` gets `system?` + executor-only
  persona params; the planner keeps `buildPlannerPrompt` untouched.

## Constitution Check

Typed RPC only (no new bridge calls), no FFI/native changes, local-only
persistence, persona params funnel through existing `validateParams` /
`mergeParams` — ✅ no violations.

## Design Decisions (see research.md)

- **D1** — personas/snippets live in `Settings` (not a new store file):
  they export/import with the 008 backup for free and survive restart
  (SC-003) with zero new persistence code.
- **D2** — seed on read: `PersonaService.list()` returns starters when
  `settings.personas` is unset; first mutation persists the seeded set
  + the change (same pattern as `default` role provisioning).
- **D3** — `preferredTag` is *suggested*, not forced: `setPersona`
  returns `suggestedTag?` and the UI offers to apply it (FR-002 says
  "offers to re-bind").
- **D4** — delete clears `personaName` on every conversation that
  references it (SC-004) and reports `cleared` count; UI confirms via
  `persona.usage` first.
- **D5** — snippet names share the tag `SLUG_RE`; validation rejects
  collisions with persona names in the same namespace (spec edge case).

## File Layout

```
src/bun/personas/service.ts     PersonaService (list/upsert/delete/
                                usage/snippets) — injectable store dep
src/bun/personas/seed.ts        starter personas + snippets
src/bun/rpc/handlers.ts         persona.* / snippet.* /
                                conversation.setPersona + send-path wiring
src/bun/llama/prompt.ts         opts.system + system render arm
src/bun/llama/fusion.ts         system/personaParams on executor
src/bun/models/roles.ts         resolveCandidates personaParams layer
renderer:
  features/personas/PersonasPanel.tsx   CRUD surface (settings)
  features/chat/ChatPage.tsx            per-conversation persona select
  features/chat/Composer.tsx            "/" snippet picker
tests/personas/                         service + prompt-budget units
tests/rpc/personas.test.ts              end-to-end contract tests
```

## Contract Delta (contracts/rpc.md)

`persona.list | persona.upsert | persona.delete | persona.usage`,
`snippet.list | snippet.upsert | snippet.delete`,
`conversation.setPersona` (+ `suggestedTag` response),
`Conversation.personaName?`, `ConversationSummary.personaName?`,
`Settings.personas`, `Settings.snippets`, `Persona`, `Snippet` types.

## Risks

- **Budget**: oversized system prompts — capped at 8 KiB at upsert;
  always-kept system turn displaces history first (documented).
- **Migration**: older conversations lack `personaName` → treated as
  `null`, no backfill needed.
