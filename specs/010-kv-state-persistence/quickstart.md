# Quickstart — 010-kv-state-persistence

1. Chat for a few turns on conversation C (single or fusion), quit.
2. `$data/kv/` holds `index.json` + blobs for `C/main` (and
   `C/planner`,`C/executor` if fusion).
3. Reopen → send on C: restore hits → `lls_generate_continue` decodes
   only the new suffix; TTFT drops vs cold prefill (SC-001 ≥50%).
4. Replace/rename the .gguf, or change ctx size → fingerprint/ctxSize
   mismatch → silent prefill (FR-003/FR-009).
5. Models page shows snapshot usage + "Clear snapshots"; dropping the
   cap in settings evicts oldest entries next write.
