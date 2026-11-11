# RPC Contract — 016-output-stats-panel

## Requests (bun)

- `metrics.list` `{}` → `{ entries: MetricEntry[] }` — whole buffer,
  chronological. Panel hydrates on open.
- `metrics.clear` `{}` → `{ removed: number }` — empties ring, idempotent.

## Messages (bun → webview)

- `metrics.entry` — `MetricEntry`, emitted after each recorded call when
  collection is on; the open panel appends live.

## Settings surface

- `settings.get` response += `outputPanel: boolean` (default false).
- `settings.set` params += `outputPanel?: boolean` — switch writes here;
  persists across restarts per FR-005.

## Engine result extension (not RPC)

- `generate()` result += `promptTokens?: number` — exact count via
  `lls_token_count` on the built prompt; absent on fake engines.
