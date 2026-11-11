# Research — 010-kv-state-persistence

## D1 — Native API: file-based state, token-echo on load

llama.cpp exposes `llama_state_save_file(ctx, path)` and
`llama_state_load_file(ctx, path, tokens_out, cap, *n_out)` (vendored
`include/llama.h:860-884`). File-based (not `state_get_data` blobs) keeps
the shim API trivially FFI-able — two new exports:

- `lls_state_save(ctx, path, err)` → bool
- `lls_state_load(ctx, path, err)` → bool

**Critical**: `lls_state_load` must repopulate the shim's `kv_tokens`
mirror from `tokens_out` (cap = `kv_cap`). Without that, the
`lls_generate_continue` LCP logic from feature 003 would compare the new
prompt against a stale/empty mirror and either full-decode or, worse,
reuse a wrong prefix. After load: `kv_count = n_out`, mirror copied.

## D2 — Restore path rides `lls_generate_continue`

Saved state = "KV after last completed turn". Next turn's prompt =
history + new turn. Restoring the mirror then calling
`lls_generate_continue(prompt)` makes LCP = the saved prefix — decode
resumes exactly at the turn boundary. No new generation path needed.

## D3 — Model fingerprint: head/tail hash, not full content

FR-003 demands content identity, but hashing a multi-GB GGUF per snapshot
check is wasteful. Fingerprint = `path + sizeBytes + sha256(first 64KiB
+ last 64KiB)`. Same-name replacement changes size or tail bytes with
overwhelming probability; cost is one 128 KiB read. Computed once per
model load, cached by `models/library` alongside meta.

## D4 — Layout + atomicity

```
$data/kv/index.json          manifest: entries keyed "convId/roleKey"
$data/kv/<convId>/<role>.kv  state blob (tmp+rename write)
$data/kv/<convId>/<role>.tmp torn-write residue, swept on boot
```

Manifest written only *after* blob rename commits — manifest absence ⇒
blob is junk even if present. Orphan sweep on store construction.
`llama_state_load_file` failure + fingerprint/ctxSize mismatch + missing
file all collapse to one outcome: normal prefill (FR-009).

## D5 — Keying: conversation × phase-role

roleKey: `"main"` (single mode) or `"planner"`/`"executor"` (fusion
phases, per FR-007). Caller supplies it — the engine only knows its own
ctx. `engine.kvConvId` (feature 003) already tracks which conversation
owns the resident KV; the same value drives snapshot save at turn end.

## D6 — Invalidation surface

Snapshot valid iff `fingerprint` AND `ctxSize` match the live ctx.
Generation params don't affect KV (they're sampling-side) — not in the
key. Model rebind → different model path → different fingerprint →
silent discard, exactly FR-003.

## D7 — Registry hook for FR-008

`registry.evict(path)` gains an optional `onEvict(ctx)` dep invoked
*before* the slot frees — handlers pass a closure that saves the
snapshot if the evicted ctx carries a tagged `kvConvId`.

## D8 — Policy surface

`settings.snapshot: { enabled: boolean, maxBytes: number }` (default
`{enabled:true, maxBytes: 2 GiB}`). LRU = oldest `updatedAt` evicted
while `total > maxBytes`. RPC: `snapshot.stats` →
`{count, usedBytes, maxBytes}`, `snapshot.clear` → `{removed, freedBytes}`.

## D9 — Shim version tolerance

`ffi.ts` already guards symbols; absent `lls_state_*` (stale shim) ⇒
snapshot layer no-ops. Native-only code paths are never unit-tested —
`SnapshotStore` (fs/manifest/policy) is pure-Bun and fully tested; the
shim/ffi boundary stays a thin pass-through.
