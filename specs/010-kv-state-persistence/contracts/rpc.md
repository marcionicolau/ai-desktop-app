# RPC Contract — 010-kv-state-persistence

## `snapshot.stats`

Request: `{}`
Response: `SnapshotStats` — `{count, usedBytes, maxBytes}`; `maxBytes`
reflects `settings.snapshot.maxBytes` (0 = disabled shown as cap).

## `snapshot.clear`

Request: `{}`
Response: `{removed, freedBytes}` — deletes all blobs + manifest
entries; returns what was freed. Idempotent: empty store → `{0,0}`.

## Shim (FFI, not RPC)

- `lls_state_save(ctx, path, err) -> bool`
- `lls_state_load(ctx, path, err) -> bool` — also rebuilds the KV
  mirror; after success the next `lls_generate_continue` LCP-resumes.
- Both optional in `ffi.ts`: absent ⇒ engine skips snapshot logic.
