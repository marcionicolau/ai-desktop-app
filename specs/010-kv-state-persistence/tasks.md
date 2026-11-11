# Tasks — 010-kv-state-persistence

## Phase 1 — foundational

- [X] T001 `src/shared/types.ts`: `SnapshotPolicy`, `SnapshotStats`,
  `SnapshotClearResult`; `settings.snapshot?: SnapshotPolicy`
  (undefined → `{enabled:true, maxBytes:2GiB}`).
- [X] T002 `src/shared/rpc-contract.ts`: `snapshot.stats` →
  `SnapshotStats`, `snapshot.clear` → `SnapshotClearResult`.
- [X] T003 `src/bun/store/paths.ts`: `kvDir()` = `dataDir()/kv`.
- [X] T004 `src/bun/kv/store.ts` NEW `SnapshotStore`:
  manifest load/write, `entryKey(convId,roleKey)`, `save({key,blobPath,
  modelPath,fingerprint,ctxSize,sizeBytes})` (manifest-append after
  caller renamed blob), `lookup(key,fingerprint,ctxSize)` → entry|null,
  `stats()`, `clear()`, `enforce()` LRU by `updatedAt` while
  `total>maxBytes`, orphan `.tmp`/unreferenced `.kv` sweep in ctor,
  disabled-policy no-ops.
- [X] T005 [P] `tests/bun/kv-store.test.ts`: manifest round-trip,
  fingerprint/ctxSize mismatch → null, LRU eviction order, cap config,
  clear idempotent, torn `.tmp` + orphan blob sweep, disabled → no-op.
- [X] T006 `src/bun/models/library.ts`: `modelFingerprint(path)` —
  `path|size|sha256(head64K∥tail64K)`, cached per path.
- [X] T007 [P] `tests/bun/kv-store.test.ts`: fingerprint changes on
  same-name byte replacement and on size change.

## Phase 2 — native + engine (US1, P1)

- [X] T008 `src/native/shim/llama_shim.{h,c}`: `lls_state_save(ctx,path,
  err)` → `llama_state_save_file`; `lls_state_load(ctx,path,err)` →
  `llama_state_load_file` into a `kv_cap`-bounded temp buffer, copy
  `tokens_out`→`kv_tokens`, set `kv_count`. Update `llama_shim.h`
  doc comment. Rebuild via `scripts/build-native.sh`.
- [X] T009 `src/bun/llama/ffi.ts`: +2 optional symbols (i32 returns).
- [X] T010 `src/bun/llama/engine.ts`: `kvRoleKey` field alongside
  `kvConvId`; `saveState(store,fingerprint)` → shim save to `.tmp` +
  rename + `store.save(...)`; `tryRestore(store,fingerprint)` → shim
  load on manifest hit, false on any failure. `prompt()` calls
  `tryRestore` when `convId!==kvConvId` before `generate_begin`, then
  uses `generate_continue` either way it has resident state.
- [X] T011 `src/bun/models/registry.ts`: `onEvict?: (ctx)=>void` dep,
  invoked before slot free.
- [X] T012 `src/bun/rpc/handlers.ts`: lazy `SnapshotStore` singleton;
  after each `chat.done` persist → `engine.saveState` (roleKey `main`,
  or `planner`/`executor` per fusion phase); `model.load`/`setMode`
  rebinds must reset the conv↔slot `kvConvId` so stale snapshots
  aren't tagged to a new model; `onEvict` wiring; `snapshot.stats` +
  `snapshot.clear` handlers.
- [X] T013 `tests/rpc/snapshot.test.ts`: stats/clear contract via DI
  store; disabled policy → `{0,...}`; clear frees blobs.

## Phase 3 — bounded storage UI (US2, P2)

- [X] T014 `src/renderer/.../ModelLibrary.tsx` (or settings surface):
  "KV snapshot storage" row — `used/max` formatted, count, Clear
  button → `snapshot.clear` → re-fetch stats.
- [X] T015 `tests/rpc/snapshot.test.ts`: stats reflect saves+evictions
  through the handler boundary.

## Phase 4 — polish

- [X] T016 `specs/010-kv-state-persistence/validation.md` mapping
  FR-001..010 + SC-001..005 to tests/code.
- [X] T017 Gates: `bun run test`, `tsc --noEmit`, `oxlint`,
  `hutch run build` (native rebuild included); AGENTS.md section.

## Dependencies & notes

- US1 (T008–T013) needs T001–T007. US2 (T014–T015) needs T012+T013.
- MVP: T001–T013 — resume-without-prefill ships alone.
- Parallel: T005 ∥ T006; T011 ∥ T012(partial); T014 ∥ T015.
- Format: `- [ ] T### [P?] [USn?] description + file path`.
