# Implementation Plan — 010-kv-state-persistence

**Branch**: `010-kv-state-persistence` · **Spec**: `spec.md` · **Research**: `research.md`

## Summary

Persist llama.cpp decode state per conversation (× fusion phase) so
reopening a chat skips re-prefill. Two new shim exports wrap
`llama_state_save_file`/`llama_state_load_file`; a pure-Bun
`SnapshotStore` owns manifest, atomic writes, fingerprint validation,
and LRU-bounded disk. Save at turn end + on registry eviction; restore
feeds `lls_generate_continue` so LCP resumes at the turn boundary.

## Technical Context

- Vendored llama.cpp already exposes `llama_state_*_file` (llama.h:860+)
- Shim has a `kv_tokens` mirror + `lls_generate_continue` LCP (feat 003)
- `engine.kvConvId` tracks the resident conversation
- `paths.ts` `dataDir()` + `APP_DATA_DIR` env override for tests
- Registry `evict(path)` is the slot-teardown seam (FR-008)

## Architecture

```
native/shim        +lls_state_save / +lls_state_load (mirror rebuild)
llama/ffi.ts       +2 symbols (optional — stale shim ⇒ no-op)
kv/store.ts  NEW   SnapshotStore: manifest, tmp+rename, fingerprint,
                   LRU/maxBytes, orphan sweep, stats/clear — pure Bun
llama/engine.ts    saveState(convId,roleKey) / tryRestore(convId,roleKey)
models/registry.ts onEvict dep (FR-008)
rpc/handlers.ts    save after chat.done per phase; snapshot.stats/clear
shared/types.ts    SnapshotPolicy, SnapshotStats, settings.snapshot
renderer           Models/settings row: usage + Clear button
```

## File changes

| File | Change |
|---|---|
| `src/native/shim/llama_shim.{h,c}` | `lls_state_save/load`; load repopulates `kv_tokens` mirror from `tokens_out` |
| `src/bun/llama/ffi.ts` | +2 optional symbols |
| `src/bun/store/paths.ts` | `kvDir()` |
| `src/bun/kv/store.ts` | NEW — `SnapshotStore` |
| `src/bun/models/library.ts` | `fingerprint(model)` — path+size+head/tail sha256, cached |
| `src/bun/llama/engine.ts` | `kvRoleKey`, `saveState`, `tryRestore`; restore→`generate_continue` |
| `src/bun/models/registry.ts` | `onEvict` dep |
| `src/bun/rpc/handlers.ts` | wire save@turn-end (single+fusion), stats/clear RPC |
| `src/shared/types.ts` | `SnapshotPolicy`/`SnapshotStats` + `settings.snapshot` |
| `src/shared/rpc-contract.ts` | `snapshot.stats`, `snapshot.clear` |
| `src/renderer/.../ModelLibrary.tsx` | snapshot usage + clear row |
| `tests/bun/kv-store.test.ts` | NEW — manifest/LRU/fingerprint/atomic/orphans |
| `tests/rpc/snapshot.test.ts` | NEW — stats/clear contract |

## Constitution check

Native additions stay inside the shim with err-string convention; all
renderer↔main flows via typed RPC; snapshot I/O main-process only
(FR-010). No new dependencies.
