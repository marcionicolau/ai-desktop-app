# Research — 016-output-stats-panel

## D1 — Prompt tokens: reuse `lls_token_count`, no new shim symbol

The shim already tokenizes the built prompt in `lls_generate_begin` —
the exact "sent" count equals `lls_token_count(ctx, prompt)` with the
same tokenizer. Engine returns it as `promptTokens` on `generate`'s
result (optional field; fake engines omit it). One extra tokenize per
turn is milliseconds — cheaper than a new FFI symbol + stale-shim
fallback matrix. Clarification permits new methods but doesn't require
them; zero native changes wins.

## D2 — Collection point: handlers, not engine

`engine.generate` returns `{tokens, elapsedMs, warm, promptTokens}` —
pure transport. The *entry* is assembled in `handlers.ts` where
conversation context lives (convId, personaName, attempt tag, fallback
flag, `current` for the preview). Fusion gets an `onMetric` callback in
`FusionTurnOpts` — one entry per phase with `roleKey: "planner"|
"executor"` and the serving `role.fileName`.

## D3 — Store: in-memory ring, emit-on-record

`metrics/store.ts` `MetricsStore`: array capped at 500 (shift oldest),
`record(entry)` → returns the stored entry, `list()` shallow copy,
`clear()` → `{removed}`. Handlers emit `metrics.entry` after each
record so the open panel streams live; `metrics.list` hydrates on open.

## D4 — Panel gate: `settings.outputPanel`

`settings.get` response gains `outputPanel`; `settings.set` params gain
`outputPanel?: boolean`. Collection checks the flag inside
`record()`-call sites — off ⇒ zero overhead, zero entries (spec edge
case). Renderer switch → `settings.set` → local flag drives dock.

## D5 — Layout: bottom dock, flex column

`ChatPage` is already a `flex-col` — the panel mounts as a sibling
*below* `MessageList`/`Composer` inside the same column; opening it
naturally pushes the message area up (clarified behavior), no absolute
positioning. Fixed height ~240 px, `overflow-y-auto`.

## D6 — Tabs: hand-rolled, dependency-free

`src/renderer/src/components/ui` has no Tabs/Switch primitive; the
codebase style is minimal custom components. Panel tabs = a row of
model-file buttons; groups inside = `roleKey` section → persona
subdivision. Switch = small toggle button (same visual language as
existing toggles like the fusion/sidebar controls).

## D7 — Fusion provenance

`phases.plan/answer` already carry `tag`/`fileName`/`servedBy` — the
metrics callback reuses `ResolvedRole` directly (fileName + servedBy
fallback flag), so fallback entries file under the serving model per
FR-004.
