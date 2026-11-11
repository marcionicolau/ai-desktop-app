# Research — 011-model-advisor

## D1 — Benchmark runs through the one engine

llama.cpp context is single-flight (`engine.isGenerating()`); a second
resident model would both break the invariant and inflate the RSS
delta being measured. The benchmark therefore:

1. Refuses while `isGenerating()` or another benchmark runs → `BUSY`.
2. Loads the target path via `deps.engine.loadModel` (this unloads the
   active model — `lls_model_free` order is already correct).
3. Samples RSS, runs a **fixed** bounded prompt with `maxTokens: 128`
   and a 25 s wall-time cap (`stop()` then keeps whatever tokens were
   produced — partial records stay measured, flagged).
4. Computes `tokensPerSec = tokens / elapsed`, `peakBytes = max(rss) −
   rssBefore`, floored at the file size (RSS noise can under-read).
5. Unloads; reloads the previously bound model (from
   `settings.activeModelPath` / `roles` `default` binding) if any.

The benchmark prompt is constant (`"Explain photosynthesis in
detail."`-style, ~15 tokens) so tok/s is comparable across models —
repeatability target ±20% (SC-001) is realistic since it's the same
sampler defaults every run.

## D2 — Fingerprint = `fileName:sizeBytes`

A rename or content change both alter the key; hash would add seconds
per scan. Collision risk (same name+size, different bytes) is
acceptable for a cache — the value is only advisory.

## D3 — Context size

`lls_ctx_create` uses shim defaults; no per-load ctx parameter exists
in the FFI today and adding one is out of scope. Benchmarks measure at
default ctx — consistent and honest.

## D4 — Recommended context size

KV memory scales ~linearly with ctx. `kvPerToken ≈ (peakBytes −
fileSize) / defaultCtx` when measured (rough but honest, flagged
`estimated`); when unmeasured use a conservative fallback
(`fileSize/4096` per token is too aggressive — use a fixed 256 KB/token
upper-ish bound for 7-14B models, still flagged). Then:

`recommendedCtx = min(contextTrain ?? 32768, pow2floor((free − headroom
− fileSize) / kvPerToken))`, headroom = max(1 GiB, 15% of total).

Verdict: `wontfit` if `fileSize + minCtx(kv) > free`; `tight` if within
1.5× headroom; else `fits`.

## D5 — Fusion combined fit

Resolve `plannerTag`/`executorTag` bindings via
`RolesService.bindingPath` → two model files. Sequential peak =
`max(peakA, peakB)` (only one ctx live at a time — verified in
`fusion.ts`: phases run serially through the same engine). Combined
residency = `fileA + fileB` (weights may both stay mmap'd — report it
separately so users can decide warm-vs-evict). Verdict on the peak
against live `freemem`.

## Alternatives considered

- **GGUF-predicted memory** (no benchmark): rejected — spec explicitly
  wants measured numbers; prediction stays as the `estimated` basis.
- **Sampling RSS inside the shim**: unnecessary; process RSS covers
  model+ctx+KV in this single-process architecture.
- **Blocking loads on `wontfit`**: spec says advisor warns, never
  hard-blocks (Assumptions).
