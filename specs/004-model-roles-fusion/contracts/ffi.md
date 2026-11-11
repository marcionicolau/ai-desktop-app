# FFI Contract: Multi-Handle Notes (Feature 004)

**No new FFI symbols.** The existing ABI already supports the feature:

- `lls_model_load(path, err) → lls_model*` / `lls_ctx_create(model, err)
  → lls_ctx*` are per-handle — N models/N ctxs coexist natively.
- `ModelRegistry` (research D1) simply holds multiple handle pairs; each
  ctx keeps its own token mirror so KV reuse is per-model, per-
  conversation as before.

## Ownership rules (unchanged, now N×)

- Shutdown per slot: `lls_generate_end` (if active) → `lls_ctx_free` →
  `lls_model_free`. Slots are freed on eviction or app shutdown.
- `lls_step` remains single-threaded on the Bun thread — sequential fusion
  phases mean at most one ctx decodes at a time; no concurrency concern.
- One `lls_model*` may back multiple ctxs in future; v1 uses exactly one
  ctx per slot (per model).

## Constraints

- `MAX_SLOTS = 2` loaded models (memory policy, enforced in registry —
  not the shim).
- Generation remains single-flight per turn across *all* slots: a fusion
  turn holds the global turn gate from planner phase through executor
  phase (`ENGINE_BUSY` semantics unchanged).
