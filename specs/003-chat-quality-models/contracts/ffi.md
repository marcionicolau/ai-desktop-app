# FFI Contract Delta — Feature 003

Extends the v1 ABI (feature-001 `contracts/ffi.md`). All rules from that
contract still apply (pull model, `char**` err freed via `lls_free_string`,
shutdown order).

## New struct

```c
typedef struct lls_gen_params {
    float    temperature;    // 0.0–2.0; 0 = greedy
    float    top_p;          // 0.0–1.0; 1 = off
    int32_t  top_k;          // 0 = off
    float    repeat_penalty; // 1.0 = off
    uint32_t seed;           // 0 = random
    int32_t  max_tokens;     // 0 = no cap (ctx-bound)
    int32_t  n_threads;      // 0 = default
    int32_t  n_gpu_layers;   // 0 = CPU
} lls_gen_params;
```

## Signature changes

| Symbol | New signature | Notes |
|--------|---------------|-------|
| `lls_generate_begin` | `int lls_generate_begin(lls_ctx* c, const char* prompt, const lls_gen_params* p, char** err)` | `p==NULL` → defaults (greedy, 512 cap — current behavior) |

## New symbols

| Symbol | Signature | Semantics |
|--------|-----------|-----------|
| `lls_generate_continue` | `int lls_generate_continue(lls_ctx* c, const char* prompt_delta, const lls_gen_params* p, char** err)` | decodes `prompt_delta` onto existing KV (no `memory_clear`, `add_special=false`); caller MUST guarantee the prefix is unchanged |
| `lls_token_count` | `int32_t lls_token_count(lls_ctx* c, const char* text)` | token count via `llama_tokenize` with NULL buffer; `≤0` on error |
| `lls_gguf_meta` | `char* lls_gguf_meta(const char* path, char** err)` | parses GGUF header; returns JSON `{name, architecture, paramCount, quantization, contextTrain}` — caller frees via `lls_free_string` |

## Invariants

- `lls_generate_continue` after `lls_memory` divergence is UB — JS-side
  fingerprint gates all calls.
- `max_tokens==0` means "generate until EOS or KV full" (cap param replaces
  the hardcoded 512/`LLS_MAX_GEN` default; `LLS_MAX_GEN` env still overrides
  when `p==NULL`).
- `lls_gguf_meta` never loads tensors — header-only read.
