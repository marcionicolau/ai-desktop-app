# FFI Contract: Bun ↔ `llama_shim` (C ABI)

Surface exposed by `src/native/shim/llama_shim.c`, loaded via `bun:ffi`
`dlopen()`. All types are plain C; all handles are opaque `void*`.
Memory-ownership rules are normative (see research.md Decision 5).

**Threading model**: pull-based, single-threaded. All FFI calls run on the JS
thread. Generation is stepped — each `lls_step` performs one decode/sample
iteration and returns token bytes through a caller-provided buffer. No C
worker threads and no `JSCallback` are used (empirically verified: invoking a
`JSCallback` from a non-JS thread deadlocks under `bun:ffi`).

## Symbols

| Symbol | Signature | Notes |
|--------|-----------|-------|
| `lls_version` | `const char* lls_version(void)` | static string; never freed |
| `lls_model_load` | `lls_model* lls_model_load(const char* path, char** err)` | NULL on failure; `err` set, freed via `lls_free_string` |
| `lls_model_free` | `void lls_model_free(lls_model* m)` | must follow context free; NULL-safe |
| `lls_ctx_create` | `lls_ctx* lls_ctx_create(lls_model* m, char** err)` | one active context per model |
| `lls_ctx_free` | `void lls_ctx_free(lls_ctx* c)` | requires `lls_generate_end` first if generation is active |
| `lls_generate_begin` | `int lls_generate_begin(lls_ctx* c, const char* prompt, char** err)` | tokenizes prompt and primes generation; `0` ok / nonzero error |
| `lls_step` | `int lls_step(lls_ctx* c, char* buf, size_t cap, size_t* out_len)` | `1` = token written to `buf` (`out_len` = byte count), `0` = done, `<0` = error. Called in a loop by JS; between calls the JS event loop stays free |
| `lls_generate_end` | `void lls_generate_end(lls_ctx* c)` | releases generation state; idempotent; called after `lls_step` returns `0`/`<0` or on stop |
| `lls_free_string` | `void lls_free_string(char* s)` | frees any `char*` the shim allocated |

## Ownership rules

1. Handles are owned by the caller; every create/begin has a matching free/end.
2. `char** err` out-params are shim-allocated → caller MUST call
   `lls_free_string`.
3. `buf` in `lls_step` is caller-allocated (JS `ArrayBuffer`/`ptr`); shim
   writes at most `cap` bytes per call and never retains the pointer.
4. Stop semantics: JS sets its own stop flag and simply stops calling
   `lls_step`, then calls `lls_generate_end` — no signal needed across
   threads since there is no worker.
5. Shutdown order: `lls_generate_end` (if generating) → `lls_ctx_free` →
   `lls_model_free` → `Library.close()`. Violating order is undefined
   behavior.

## Platform artifacts

| OS | Shim | Dependencies (bundled alongside) |
|----|------|----------------------------------|
| Linux | `libllama_shim.so` | `libllama.so`, `libggml*.so` |
| macOS | `libllama_shim.dylib` | `libllama.dylib`, `libggml*.dylib` (`@rpath`) |
| Windows | `llama_shim.dll` | `llama.dll`, `ggml*.dll` |
