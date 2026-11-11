# Implementation Plan — 016-output-stats-panel

**Branch**: `016-output-stats-panel` · **Spec**: `spec.md` · **Research**: `research.md`

## Summary

A main-process `MetricsStore` records one entry per generation call
(prompt/output tokens, elapsed, model, role, persona, preview).
Handlers emit `metrics.entry` per record; a bottom-dock `OutputPanel`
hydrates via `metrics.list`, streams live, and groups entries in
per-model tabs by role/persona. `settings.outputPanel` gates both the
dock and collection. No native changes — `lls_token_count` supplies
exact prompt tokens.

## Technical Context

- `generate` returns `{tokens, elapsedMs, warm}`; `lls_token_count` is
  already exposed — engine adds `promptTokens` to the result
- `chat.done`/`chat.phase` event plumbing exists; `metrics.entry` rides
  the same `webview.messages` channel
- `settings.get`/`settings.set` are the settings surface; adding
  `outputPanel` is contract-compatible
- `ChatPage` is `flex-col`; a bottom sibling dock pushes messages up
- No Tabs/Switch primitives — hand-rolled per codebase style

## File changes

| File | Change |
|---|---|
| `src/shared/types.ts` | `MetricEntry`, `settings.outputPanel` |
| `src/shared/rpc-contract.ts` | `metrics.list`, `metrics.clear` requests; `metrics.entry` message; `settings.get`/`set` `outputPanel` |
| `src/bun/metrics/store.ts` | NEW — `MetricsStore` ring(500) |
| `src/bun/llama/engine.ts` | `promptTokens` on `generate` result |
| `src/bun/rpc/handlers.ts` | `metrics` dep + record (single+fallback), `metrics.*` handlers, settings passthrough |
| `src/bun/llama/fusion.ts` | `onMetric` opt → per-phase entries |
| `src/renderer/.../metrics/OutputPanel.tsx` | NEW — bottom dock, model tabs, role/persona groups, clear btn |
| `src/renderer/.../chat/ChatPage.tsx` | dock mount + header switch + `metrics.entry` feed |
| `src/renderer/src/lib/rpc.ts` | `metrics.entry` dispatch arm |
| `tests/bun/metrics.test.ts` | ring cap, clear, record |
| `tests/rpc/metrics.test.ts` | recording per call/fusion/fallback, gate off, clear, preview ≤120 |

## Constitution check

Typed RPC only; metrics stay main-process (FR-009); zero new deps;
no native changes.
