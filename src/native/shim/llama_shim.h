// llama_shim.h - stable C11 ABI between bun:ffi and llama.cpp.
//
// Threading model: pull-based, single-threaded. All calls run on the JS
// thread. Generation is stepped: each lls_step performs one decode/sample
// iteration and returns token bytes through a caller-provided buffer.
// No C worker threads and no JSCallback are used.
//
// Ownership rules (normative):
//   - handles are owned by the caller; every create/begin has a matching
//     free/end
//   - char** err out-params are shim-allocated; caller frees via
//     lls_free_string
//   - buf in lls_step is caller-allocated; the shim writes at most cap bytes
//     per call and never retains the pointer
//   - shutdown order: lls_generate_end (if generating) -> lls_ctx_free ->
//     lls_model_free -> library close

#ifndef LLAMA_SHIM_H
#define LLAMA_SHIM_H

#include <stddef.h>
#include <stdint.h>

#if defined(_WIN32)
#  define LLS_API __declspec(dllexport)
#else
#  define LLS_API __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
extern "C" {
#endif

typedef struct lls_model lls_model;
typedef struct lls_ctx lls_ctx;

// static string; never freed
LLS_API const char * lls_version(void);

// NULL on failure; err is set and must be freed via lls_free_string
LLS_API lls_model * lls_model_load(const char * path, char ** err);

// NULL-safe; must be called after all contexts are freed
LLS_API void lls_model_free(lls_model * m);

// one active context per model; NULL on failure, err is set
LLS_API lls_ctx * lls_ctx_create(lls_model * m, char ** err);

// NULL-safe; requires lls_generate_end first if generation is active
LLS_API void lls_ctx_free(lls_ctx * c);

// Borrowed pointer into model metadata (no free); NULL when the model has
// no template. JS-side prompt formatting (ChatML vs plain) keys off this.
LLS_API const char * lls_chat_template(lls_model * m);

// configured context size; 0 when c is NULL
LLS_API int32_t lls_ctx_size(lls_ctx * c);

// generation parameters for lls_generate_begin. p == NULL selects defaults
// (greedy, 512-token cap honoring the LLS_MAX_GEN env override).
// n_threads / n_gpu_layers are reserved and currently ignored.
typedef struct lls_gen_params {
    float    temperature;    // 0.0-2.0; <= 0 selects greedy decoding
    float    top_p;          // 0.0-1.0; >= 1.0 = off
    int32_t  top_k;          // 0 = off
    float    repeat_penalty; // 1.0 = off
    uint32_t seed;           // 0 = random
    int32_t  max_tokens;     // 0 = no cap (bounded by context size)
    int32_t  n_threads;      // reserved
    int32_t  n_gpu_layers;   // reserved
} lls_gen_params;

// tokenizes the prompt, clears the KV cache, primes generation
// returns 0 on success, nonzero on failure (err is set)
LLS_API int lls_generate_begin(lls_ctx * c, const char * prompt,
                               const lls_gen_params * p, char ** err);

// like lls_generate_begin but reuses the KV prefix when the new prompt's
// leading tokens match the previous decode exactly (verified by hash).
// returns 0 = prefix reused, 2 = fell back to full decode, nonzero = error
LLS_API int lls_generate_continue(lls_ctx * c, const char * prompt,
                                  const lls_gen_params * p, char ** err);

// token count for text (special tokens included); <= 0 on error
LLS_API int32_t lls_token_count(lls_ctx * c, const char * text);

// 1 = token written to buf (out_len = byte count), 0 = done, <0 = error
LLS_API int lls_step(lls_ctx * c, char * buf, size_t cap, size_t * out_len);

// releases generation state; idempotent; NULL-safe
LLS_API void lls_generate_end(lls_ctx * c);

// parses GGUF header metadata without loading the model; returns a
// shim-allocated JSON string {name,architecture,paramCount,quantization,
// contextTrain} (fields null when absent) or NULL on failure — free via
// lls_free_string either way
LLS_API char * lls_gguf_meta(const char * path, char ** err);

// frees any char* the shim allocated
LLS_API void lls_free_string(char * s);

#ifdef __cplusplus
}
#endif

#endif // LLAMA_SHIM_H
