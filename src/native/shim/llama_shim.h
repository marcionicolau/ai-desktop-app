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

// configured context-window size in tokens; 0 on NULL
LLS_API // Borrowed pointer into model metadata (no free); NULL when the model has
// no template. JS-side prompt formatting (ChatML vs plain) keys off this.
LLS_API const char * lls_chat_template(lls_model * m);

// configured context size; 0 when c is NULL
LLS_API int32_t lls_ctx_size(lls_ctx * c);

// tokenizes the prompt, clears the KV cache, primes generation
// returns 0 on success, nonzero on failure (err is set)
LLS_API int lls_generate_begin(lls_ctx * c, const char * prompt, char ** err);

// 1 = token written to buf (out_len = byte count), 0 = done, <0 = error
LLS_API int lls_step(lls_ctx * c, char * buf, size_t cap, size_t * out_len);

// releases generation state; idempotent; NULL-safe
LLS_API void lls_generate_end(lls_ctx * c);

// frees any char* the shim allocated
LLS_API void lls_free_string(char * s);

#ifdef __cplusplus
}
#endif

#endif // LLAMA_SHIM_H
