# Research: Tagged Model Roles & Planner–Executor Fusion

All NEEDS CLARIFICATION resolved through codebase inspection and the
reference `litellm_config.yaml` pattern. No external research needed —
every decision grounds in existing project structure.

## D1 — Multi-model management: `ModelRegistry` (Registry pattern)

**Decision**: A `ModelRegistry` owns a `Map<normalizedPath, ModelSlot>`
where `ModelSlot = { model, ctx, name, generatingFor: conversationId|null,
lastUsedAt }`. `acquire(path)` returns the shared slot; `release`/`evict`
manages lifecycle.

**Rationale**: the shim already exposes per-handle `lls_model*`/`lls_ctx*`
pairs — two loaded models is just two entries. Registry gives FR-011
(shared slot for two tags on one file) for free via path keys, keeps a
single eviction policy (`MAX_SLOTS = 2`, evict least-recently-used
non-busy slot), and centralizes busy/ownership guards.

**Alternatives**: (a) two hardcoded engine fields (`plannerEngine`,
`executorEngine`) — rejects arbitrary tags and shared-slot dedup; (b) one
ctx per tag — wasteful when tags share files. Both rejected.

## D2 — Role resolution: `RoleResolver` (Chain of Responsibility)

**Decision**: `resolve(tagName) → ResolvedRole { path, fileName, params,
servedBy }` walks: tag binding → fallback chain entries (`tag:` or
`model:` refs, depth-capped at 3, cycle-detected) → typed `ROLE_UNBOUND`.

**Rationale**: mirrors `router_settings.fallbacks` semantics; cycle-safe
bounded walk is trivially testable; `servedBy` records which candidate
served (FR-009's "records the fallback use").

**Alternatives**: implicit fallback by name convention — fragile, hidden.

## D3 — Param cascade: reuse `mergeParams` (Strategy)

**Decision**: effective params = `DEFAULT ← settings.generation ←
modelOverrides[file] ← tag.params`. Tag overrides win (FR-003), applied at
resolution so phases get role-specific behavior (planner temp 0.1,
executor normal).

**Rationale**: existing `mergeParams`/`validateParams` already implement
partial-merge + clamping; the tag layer is just one more precedence step.

## D4 — Fusion execution: sequential `FusionOrchestrator` (State Machine)

**Decision**: `runFusionTurn(conv, userMsg)` — phases
`planning → answering → done|partial|failed`. Each phase = one
`engine.generate` call on the resolved slot's ctx, same stepped token loop.
Stop is honored mid-phase (via `lls_step` abort) and at the boundary (a
stopped planning phase skips answering, turn lands `partial`).

**Rationale**: constitution-adjacent simplicity — one "turn" keeps the
existing single-flight gate (`ENGINE_BUSY` semantics unchanged); sequential
phases bound peak memory to one active decode and avoid interleaved
token-stream complexity.

**Alternatives**: (a) concurrent phases — impossible, executor needs plan;
(b) worker threads for parallel ctxs — rejected before (threaded FFI is
out of scope); (c) spec already mandates sequential.

## D5 — Prompt strategy: planner template + inline injection

**Decision**: `plan-prompt.ts` exports `buildPlannerPrompt(userText)` —
system-less template: "You are a planning model. Produce a concise plan
(≤N lines, no prose answer) for:" + user text; and
`buildExecutorPrompt(userText, plan)` — injects plan as a fenced
`<plan>…</plan>` block before the user turn in the normal `buildPrompt`
history. Both use the *bound model's own* chat template via existing
`PromptTurn` plumbing.

**Rationale**: planner output is user-visible (spec assumption) so no
schema/JSON constraint is needed; plain structured-text plan maximizes
small-model compliance; `<plan>` injection works through the existing
prompt path untouched — executor phase is literally a normal generation
with extra context, so budgeting/truncation/KV reuse all apply unmodified.

**Alternatives**: JSON-schema plan (fragile on small models, no structured
output support in shim); separate planner system prompt in model template
(overfit — templates differ per model).

## D6 — Events: extend `chat.token` with `phase`, per-phase stats in `chat.done`

**Decision**: `chat.token` gains optional `phase?: "plan"|"answer"`;
`chat.done.stats` becomes `{ plan?: MessageStats; answer?: MessageStats;
total?: MessageStats }`. A new `chat.phase` event marks transitions
(`{messageId, phase, tag, fileName}`) so UI can label phases and show
"planner ↔ executor" model names.

**Rationale**: single token channel keeps renderer routing trivial
(`planToken` would duplicate buffering logic); `chat.phase` gives the UI a
clean transition point for the collapsible plan block. Backward
compatible: `phase` absent ⇒ single-model.

## D7 — Persistence: extend `settings.json` + `Conversation`, not new files

**Decision**: `settings.json` gains `tags: ModelTag[]` (name, label,
description, `binding: fileName|null`, `params`, `fallback: Ref[]`).
`Conversation` gains `mode: "single"|"fusion"` + `plannerTag`/`executorTag`
defaults `"planner"`/`"executor"`. Store validates on load; missing tags
field ⇒ `[]` + provision `default` (bound to `activeModelPath`),
`planner`/`executor` unbound. The `default` tag and `activeModelPath` are
kept in sync both directions so single-mode chat also resolves by tag —
making FR-010's "all entry points" literally true rather than
fusion-only.

**Rationale**: atomic single-file writes already proven; tags are few
(<20) so no indexing needed; conversation-local mode satisfies "opt-in per
conversation".

## D8 — Download→bind: optional `tagName` on `model.download`

**Decision**: `model.download` accepts `{url, fileName, tagName?}`; on
`done`, `roles.bind(tagName, fileName)` runs as a post-step. `.part`/error
paths never bind (FR-004).

**Rationale**: atomic "download succeeds → bind" matches the spec's
one-flow requirement without a new request type; failure can't leave a
dangling binding since bind only happens post-rename.

## D9 — In-flight vs. rebinding semantics (spec edge case)

**Decision**: a slot snapshot is taken at turn start (`acquire` pins the
slot for the turn); rebinding changes *resolution*, not the pinned slot.
`role.bind` on a tag whose bound file is mid-turn marks the slot `stale` —
freed after the turn, evicted on next `acquire` if still unused.

**Rationale**: simplest correct semantics for "in-flight keeps its model";
no refcounting beyond a busy flag; eviction is lazy not eager.
