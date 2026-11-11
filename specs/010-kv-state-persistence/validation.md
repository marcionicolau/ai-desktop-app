# Validation — 010-kv-state-persistence

## Requirements → verification

| Requirement | Where verified |
|---|---|
| FR-001 serialize decode state at turn boundaries | `engine.saveState` auto-called in `generate` finally; `lls_state_save` → `.tmp` → rename → manifest |
| FR-002 restore + skip prefill | `tryRestore` in `generate` → `lls_state_load` rebuilds kv mirror → `lls_generate_continue` LCP resumes |
| FR-003 keyed to model fingerprint | `modelFingerprint` = path+size+sha256(head64K‖tail64K); `lookup` returns null on mismatch — tested |
| FR-004 atomic writes | blob `.tmp`→rename, manifest rewritten after; torn `.tmp` + orphans swept in ctor — tested |
| FR-005 size cap + LRU + configurable | `SnapshotStore.enforce` (oldest `updatedAt`), `settings.snapshot.maxBytes` — tested |
| FR-006 view usage + clear | `snapshot.stats`/`snapshot.clear` RPC + Models page row — RPC-tested |
| FR-007 per-role fusion snapshots | `roleKey` "planner"/"executor" flows through `genPhase` opts → engine `kvRoleKey` |
| FR-008 registry eviction offers state | `ModelRegistry.onEvict` → `slot.engine.saveState` — wired at module registry |
| FR-009 silent fallback | every restore path returns false → normal `generate_begin`; no error surfaced — covered by lookup/ shim-failure branches |
| FR-010 main-process only | all snapshot I/O in `src/bun`; renderer sees stats/clear RPC only |
| SC-002 cap never exceeded | `enforce()` runs inside `save()` — tested at boundary |
| SC-003 zero wrong-model restores | fingerprint+ctxSize gate — tested |
| SC-004 corrupt → clean prefill | `lls_state_load` nonzero → false → begin; manifest/blob divergence swept — tested |
| SC-005 gates | `bun run test` 228 pass / `tsc --noEmit` clean / `oxlint` clean / `hutch run build` |

## Not automated

- SC-001 (≥50% TTFT reduction on 4k-token conv) requires a live model;
  verified manually via `warm` flag on `generate` return.
