// llama_shim.c - pull-based generation shim over the llama.cpp C API.
// See llama_shim.h for the ABI contract and ownership rules.

#include "llama_shim.h"

#include "llama.h"

#include <stdlib.h>
#include <string.h>

#define LLS_VERSION "0.1.0"

struct lls_model {
    struct llama_model * handle;
};

struct lls_ctx {
    struct llama_context * handle;
    const struct llama_vocab * vocab;
    struct llama_sampler * smpl;
    llama_token cur;
    int generating;
    int32_t pos; // KV position; generation ends cleanly when it reaches n_ctx
    int32_t n_gen; // tokens produced since generate_begin
    int32_t max_gen; // generation cap; LLS_MAX_GEN env, default 512
};

static int backend_ready = 0;

static void set_err(char ** err, const char * msg) {
    if (err == NULL) {
        return;
    }
    const size_t n = strlen(msg) + 1;
    *err = (char *) malloc(n);
    if (*err != NULL) {
        memcpy(*err, msg, n);
    }
}

static void ensure_backend(void) {
    if (!backend_ready) {
        llama_backend_init();
        backend_ready = 1;
    }
}

const char * lls_version(void) {
    return LLS_VERSION;
}

lls_model * lls_model_load(const char * path, char ** err) {
    if (path == NULL || path[0] == '\0') {
        set_err(err, "model path is empty");
        return NULL;
    }
    ensure_backend();

    struct llama_model_params mparams = llama_model_default_params();
    struct llama_model * handle = llama_model_load_from_file(path, mparams);
    if (handle == NULL) {
        set_err(err, "failed to load model file");
        return NULL;
    }

    lls_model * m = (lls_model *) calloc(1, sizeof(lls_model));
    if (m == NULL) {
        llama_model_free(handle);
        set_err(err, "out of memory");
        return NULL;
    }
    m->handle = handle;
    return m;
}

void lls_model_free(lls_model * m) {
    if (m == NULL) {
        return;
    }
    if (m->handle != NULL) {
        llama_model_free(m->handle);
    }
    free(m);
}

lls_ctx * lls_ctx_create(lls_model * m, char ** err) {
    if (m == NULL) {
        set_err(err, "model is NULL");
        return NULL;
    }
    ensure_backend();

    struct llama_context_params cparams = llama_context_default_params();
    const int32_t train_ctx = llama_model_n_ctx_train(m->handle);
    cparams.n_ctx = (train_ctx > 0 && train_ctx < 4096) ? (uint32_t) train_ctx : 4096;
    struct llama_context * handle = llama_init_from_model(m->handle, cparams);
    if (handle == NULL) {
        set_err(err, "failed to create llama context");
        return NULL;
    }

    lls_ctx * c = (lls_ctx *) calloc(1, sizeof(lls_ctx));
    if (c == NULL) {
        llama_free(handle);
        set_err(err, "out of memory");
        return NULL;
    }
    c->handle = handle;
    c->vocab = llama_model_get_vocab(m->handle);
    return c;
}

void lls_generate_end(lls_ctx * c) {
    if (c == NULL) {
        return;
    }
    if (c->smpl != NULL) {
        llama_sampler_free(c->smpl);
        c->smpl = NULL;
    }
    c->generating = 0;
}

void lls_ctx_free(lls_ctx * c) {
    if (c == NULL) {
        return;
    }
    lls_generate_end(c);
    if (c->handle != NULL) {
        llama_free(c->handle);
    }
    free(c);
}

int lls_generate_begin(lls_ctx * c, const char * prompt,
                       const lls_gen_params * p, char ** err) {
    if (c == NULL) {
        set_err(err, "context is NULL");
        return 1;
    }
    if (c->generating) {
        set_err(err, "generation already active");
        return 1;
    }
    if (prompt == NULL) {
        set_err(err, "prompt is NULL");
        return 1;
    }

    const int32_t text_len = (int32_t) strlen(prompt);
    if (text_len == 0) {
        set_err(err, "prompt is empty");
        return 1;
    }

    const uint32_t n_ctx = llama_n_ctx(c->handle);
    const int32_t n_max = (int32_t) n_ctx;
    llama_token * tokens = (llama_token *) malloc(sizeof(llama_token) * n_max);
    if (tokens == NULL) {
        set_err(err, "out of memory");
        return 1;
    }

    int32_t n_tokens = llama_tokenize(c->vocab, prompt, text_len, tokens, n_max,
                                      /* add_special */ true,
                                      /* parse_special */ true);
    if (n_tokens < 0) {
        free(tokens);
        set_err(err, "prompt exceeds context window");
        return 1;
    }
    if (n_tokens == 0) {
        free(tokens);
        set_err(err, "prompt produced no tokens");
        return 1;
    }

    llama_memory_clear(llama_get_memory(c->handle), true);

    // decode the prompt in n_batch-sized chunks
    const uint32_t n_batch = llama_n_batch(c->handle);
    int32_t offset = 0;
    while (offset < n_tokens) {
        int32_t chunk = n_tokens - offset;
        if (chunk > (int32_t) n_batch) {
            chunk = (int32_t) n_batch;
        }
        if (llama_decode(c->handle,
                         llama_batch_get_one(tokens + offset, chunk)) != 0) {
            free(tokens);
            set_err(err, "prompt decode failed");
            return 1;
        }
        offset += chunk;
    }
    free(tokens);
    c->pos = n_tokens;
    c->n_gen = 0;
    if (p != NULL) {
        c->max_gen = p->max_tokens > 0 ? p->max_tokens : INT32_MAX;
    } else {
        const char * max_env = getenv("LLS_MAX_GEN");
        c->max_gen = (max_env != NULL && atoi(max_env) > 0)
                         ? atoi(max_env)
                         : 512;
    }

    struct llama_sampler * smpl =
        llama_sampler_chain_init(llama_sampler_chain_default_params());
    if (smpl == NULL) {
        set_err(err, "failed to create sampler");
        return 1;
    }
    // temperature <= 0 (or no params) keeps the greedy fast path; a sampling
    // chain is only built when real sampling is requested
    if (p == NULL || p->temperature <= 0.0f) {
        llama_sampler_chain_add(smpl, llama_sampler_init_greedy());
    } else {
        if (p->repeat_penalty > 1.0f) {
            llama_sampler_chain_add(
                smpl, llama_sampler_init_penalties(
                          llama_vocab_n_tokens(c->vocab), -1,
                          p->repeat_penalty, 0.0f, 0.0f));
        }
        if (p->top_k > 0) {
            llama_sampler_chain_add(smpl,
                                    llama_sampler_init_top_k(p->top_k));
        }
        if (p->top_p < 1.0f) {
            llama_sampler_chain_add(
                smpl, llama_sampler_init_top_p(p->top_p, 1));
        }
        llama_sampler_chain_add(smpl,
                                llama_sampler_init_temp(p->temperature));
        const uint32_t seed =
            p->seed != 0 ? p->seed : (uint32_t) LLAMA_DEFAULT_SEED;
        llama_sampler_chain_add(smpl, llama_sampler_init_dist(seed));
    }

    c->smpl = smpl;
    c->cur = llama_sampler_sample(smpl, c->handle, -1);
    c->generating = 1;
    return 0;
}

int lls_step(lls_ctx * c, char * buf, size_t cap, size_t * out_len) {
    if (c == NULL || !c->generating || buf == NULL || out_len == NULL) {
        return -1;
    }

    if (llama_vocab_is_eog(c->vocab, c->cur) || c->n_gen >= c->max_gen) {
        *out_len = 0;
        return 0;
    }

    const int32_t len = llama_token_to_piece(c->vocab, c->cur, buf,
                                             (int32_t) cap, /* lstrip */ 0,
                                             /* special */ false);
    if (len <= 0) {
        // token did not fit in buf or failed to convert
        return -1;
    }
    *out_len = (size_t) len;

    if (c->pos >= (int32_t) llama_n_ctx(c->handle)) {
        return 0; // KV full: end cleanly, not an error
    }
    if (llama_decode(c->handle, llama_batch_get_one(&c->cur, 1)) != 0) {
        return -1;
    }
    c->pos += 1;
    c->n_gen += 1;
    c->cur = llama_sampler_sample(c->smpl, c->handle, -1);
    return 1;
}

const char * lls_chat_template(lls_model * m) {
    if (m == NULL || m->handle == NULL) {
        return NULL;
    }
    return llama_model_chat_template(m->handle, NULL);
}

int32_t lls_ctx_size(lls_ctx * c) {
    if (c == NULL || c->handle == NULL) {
        return 0;
    }
    return (int32_t) llama_n_ctx(c->handle);
}

void lls_free_string(char * s) {
    free(s);
}
