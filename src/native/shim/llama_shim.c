// llama_shim.c - pull-based generation shim over the llama.cpp C API.
// See llama_shim.h for the ABI contract and ownership rules.

#include "llama_shim.h"

#include "llama.h"
#include "ggml-backend.h"

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
    llama_token * kv_tokens; // copy of every token currently in KV (seq 0)
    int32_t kv_count; // number of valid entries in kv_tokens
    int32_t kv_cap; // allocated capacity
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

// appends a token to the KV mirror (best-effort; OOM disables reuse)
static void kv_append(lls_ctx * c, llama_token t) {
    if (c->kv_tokens == NULL || c->kv_count >= c->kv_cap) {
        return;
    }
    c->kv_tokens[c->kv_count++] = t;
}

// feature 022 packaging fix: dynamic ggml CPU backends live next to
// this shim, not next to the bun exe, so llama's own pathless
// load_all() would miss them — the TS side passes the shim's dir here.
// A NULL/empty dir falls back to ggml's default exe-dir + cwd search.
void lls_backend_init(const char * dir) {
    if (backend_ready) return;
    if (dir != NULL && dir[0] != '\0') {
        ggml_backend_load_all_from_path(dir);
    } else {
        ggml_backend_load_all();
    }
    llama_backend_init();
    backend_ready = 1;
}

static void ensure_backend(void) {
    lls_backend_init(NULL);
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
    c->kv_cap = (int32_t) llama_n_ctx(handle);
    c->kv_tokens =
        (llama_token *) malloc(sizeof(llama_token) * (size_t) c->kv_cap);
    if (c->kv_tokens == NULL) {
        c->kv_cap = 0;
    }
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
    free(c->kv_tokens);
    c->kv_tokens = NULL;
    if (c->handle != NULL) {
        llama_free(c->handle);
    }
    free(c);
}

// shared begin/continue implementation. try_reuse=1 keeps the longest
// common token prefix between the new prompt and the KV mirror; any
// mismatch falls back to a full clear+decode. 0=reused, 2=full decode, 1=err.
static int gen_start(lls_ctx * c, const char * prompt,
                     const lls_gen_params * p, char ** err, int try_reuse) {
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

    llama_memory_t mem = llama_get_memory(c->handle);
    int32_t lcp = 0;
    if (try_reuse && c->kv_count > 0) {
        // longest common prefix of the new prompt and the KV mirror
        const int32_t lim =
            c->kv_count < n_tokens ? c->kv_count : n_tokens;
        while (lcp < lim && tokens[lcp] == c->kv_tokens[lcp]) {
            lcp++;
        }
    }
    int reused = 0;
    if (lcp > 0) {
        // keep the shared prefix; drop everything after it
        llama_memory_seq_rm(mem, 0, lcp, -1);
        c->kv_count = lcp;
        reused = 1;
    } else {
        llama_memory_clear(mem, true);
        c->kv_count = 0;
    }

    // decode the non-reused suffix in n_batch-sized chunks
    const uint32_t n_batch = llama_n_batch(c->handle);
    int32_t offset = reused ? lcp : 0;
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
        for (int32_t i = 0; i < chunk; i++) {
            kv_append(c, tokens[offset + i]);
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
    return reused ? 0 : 2;
}

int lls_generate_begin(lls_ctx * c, const char * prompt,
                       const lls_gen_params * p, char ** err) {
    const int rc = gen_start(c, prompt, p, err, /* try_reuse */ 0);
    return rc == 1 ? 1 : 0;
}

// 0 = KV prefix reused, 2 = full decode fallback, 1 = error (err set)
int lls_generate_continue(lls_ctx * c, const char * prompt,
                          const lls_gen_params * p, char ** err) {
    return gen_start(c, prompt, p, err, /* try_reuse */ 1);
}

// token count including special tokens; <= 0 on NULL/error
int32_t lls_token_count(lls_ctx * c, const char * text) {
    if (c == NULL || text == NULL) {
        return -1;
    }
    const int32_t n = llama_tokenize(c->vocab, text, (int32_t) strlen(text),
                                     NULL, 0,
                                     /* add_special */ true,
                                     /* parse_special */ true);
    return n < 0 ? -n : n;
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
    kv_append(c, c->cur);
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

// ---------- GGUF header metadata (header-only; no llama load) ----------

static int rd_exact(FILE * f, void * buf, size_t n) {
    return fread(buf, 1, n, f) == n ? 0 : -1;
}
static int rd_u32(FILE * f, uint32_t * v) { return rd_exact(f, v, 4); }
static int rd_u64(FILE * f, uint64_t * v) { return rd_exact(f, v, 8); }

static int skip_bytes(FILE * f, uint64_t n) {
    char buf[4096];
    while (n > 0) {
        const size_t chunk = n < sizeof(buf) ? (size_t) n : sizeof(buf);
        if (fread(buf, 1, chunk, f) != chunk) return -1;
        n -= chunk;
    }
    return 0;
}

static char * rd_string(FILE * f) {
    uint64_t n = 0;
    if (rd_u64(f, &n) || n == 0 || n > (1u << 20)) return NULL;
    char * s = (char *) malloc((size_t) n + 1);
    if (s == NULL) return NULL;
    if (fread(s, 1, (size_t) n, f) != (size_t) n) {
        free(s);
        return NULL;
    }
    s[n] = 0;
    return s;
}

// gguf_metadata_value_type; scalars have fixed widths
static int gguf_skip_value(FILE * f, uint32_t type) {
    uint64_t n = 0;
    uint32_t elem = 0;
    switch (type) {
    case 0: case 1: case 7: return skip_bytes(f, 1);  // u8, i8, bool
    case 2: case 3: return skip_bytes(f, 2);          // u16, i16
    case 4: case 5: case 6: return skip_bytes(f, 4);  // u32, i32, f32
    case 10: case 11: case 12: return skip_bytes(f, 8); // u64, i64, f64
    case 8:                                            // string
        if (rd_u64(f, &n)) return -1;
        return skip_bytes(f, n);
    case 9:                                            // array
        if (rd_u32(f, &elem) || rd_u64(f, &n)) return -1;
        if (n > (1ull << 32)) return -1;
        for (uint64_t i = 0; i < n; i++) {
            if (gguf_skip_value(f, elem)) return -1;
        }
        return 0;
    default:
        return -1;
    }
}

static const char * gguf_ftype_name(uint32_t ft) {
    static const char * names[] = {
        "F32",   "F16",    "Q4_0",   "Q4_1",   "Q4_1_F16", "Q4_1_0",
        "Q4_1_1","Q8_0",   "Q5_0",   "Q5_1",   "Q2_K",     "Q3_K_S",
        "Q3_K_M","Q3_K_L", "Q4_K_S", "Q4_K_M", "Q5_K_S",   "Q5_K_M",
        "Q6_K",  "IQ2_XXS","IQ2_XS", "Q2_K_S", "IQ3_XS",   "IQ3_XXS",
        "IQ1_S", "IQ4_NL", "IQ3_S",  "IQ3_M",  "IQ2_S",    "IQ2_M",
        "IQ4_XS","IQ1_M",  "BF16",
    };
    return ft < sizeof(names) / sizeof(names[0]) ? names[ft] : NULL;
}

// json-escapes s into dst (dst must hold >= 2*len+3)
static size_t json_escape(char * dst, const char * s) {
    char * d = dst;
    for (const unsigned char * p = (const unsigned char *) s; *p; p++) {
        if (*p == '"' || *p == '\\') {
            *d++ = '\\';
            *d++ = (char) *p;
        } else if (*p >= 32) {
            *d++ = (char) *p;
        }
    }
    return (size_t) (d - dst);
}

char * lls_gguf_meta(const char * path, char ** err) {
    if (path == NULL || path[0] == 0) {
        set_err(err, "path is empty");
        return NULL;
    }
    FILE * f = fopen(path, "rb");
    if (f == NULL) {
        set_err(err, "cannot open file");
        return NULL;
    }

    char * name = NULL;
    char * arch = NULL;
    char * params = NULL;
    const char * quant = NULL;
    uint32_t ftype = 0;
    uint32_t ctx_len = 0;
    int has_ftype = 0, has_ctx = 0;

    char magic[4];
    uint32_t version = 0;
    uint64_t tensor_count = 0, kv_count = 0;
    if (rd_exact(f, magic, 4) || memcmp(magic, "GGUF", 4) != 0) {
        set_err(err, "not a GGUF file");
        goto fail;
    }
    if (rd_u32(f, &version) || version < 2 || version > 3 ||
        rd_u64(f, &tensor_count) || rd_u64(f, &kv_count) ||
        kv_count > 100000) {
        set_err(err, "unsupported or corrupt GGUF header");
        goto fail;
    }

    for (uint64_t i = 0; i < kv_count; i++) {
        char * key = rd_string(f);
        if (key == NULL) {
            set_err(err, "corrupt GGUF metadata");
            goto fail;
        }
        uint32_t type = 0;
        if (rd_u32(f, &type)) {
            free(key);
            set_err(err, "corrupt GGUF metadata");
            goto fail;
        }

        if (strcmp(key, "general.name") == 0 && type == 8) {
            name = rd_string(f);
        } else if (strcmp(key, "general.architecture") == 0 && type == 8) {
            arch = rd_string(f);
        } else if (strcmp(key, "general.file_type") == 0 && type == 4) {
            if (rd_u32(f, &ftype) == 0) has_ftype = 1;
        } else if (strcmp(key, "general.parameter_count") == 0 &&
                   (type == 10 || type == 4)) {
            uint64_t pc = 0;
            uint32_t pc32 = 0;
            const int ok = type == 10 ? rd_u64(f, &pc)
                                      : (rd_u32(f, &pc32), pc = pc32, 0);
            if (ok == 0) {
                params = (char *) malloc(32);
                if (params != NULL) {
                    if (pc >= 1000000000ull) {
                        snprintf(params, 32, "%.1fB", (double) pc / 1e9);
                    } else if (pc >= 1000000ull) {
                        snprintf(params, 32, "%.0fM", (double) pc / 1e6);
                    } else {
                        snprintf(params, 32, "%llu", (unsigned long long) pc);
                    }
                }
            }
        } else if (strstr(key, ".context_length") != NULL &&
                   (type == 4 || type == 10)) {
            uint64_t v = 0;
            uint32_t v32 = 0;
            const int ok = type == 4 ? (rd_u32(f, &v32), v = v32, 0)
                                     : rd_u64(f, &v);
            if (ok == 0 && v <= 0x7fffffff && !has_ctx) {
                ctx_len = (uint32_t) v;
                has_ctx = 1;
            }
        } else {
            if (gguf_skip_value(f, type)) {
                free(key);
                set_err(err, "corrupt GGUF metadata");
                goto fail;
            }
        }
        free(key);
    }

    fclose(f);
    if (has_ftype) quant = gguf_ftype_name(ftype);

    {
        // cap: fixed skeleton + 2x each string for escaping
        const size_t cap = 256 + 2 * ((name ? strlen(name) : 0) +
                                      (arch ? strlen(arch) : 0) +
                                      (params ? strlen(params) : 0));
        char * out = (char *) malloc(cap);
        if (out == NULL) {
            set_err(err, "out of memory");
            goto fail2;
        }
        char * d = out;
        const char * strs[] = { name, arch, params, quant };
        const char * keys[] = {
            "{\"name\":",           ",\"architecture\":",
            ",\"paramCount\":",     ",\"quantization\":",
        };
        for (int i = 0; i < 4; i++) {
            d += snprintf(d, cap - (size_t) (d - out), "%s", keys[i]);
            if (strs[i] != NULL) {
                *d++ = '"';
                d += json_escape(d, strs[i]);
                *d++ = '"';
            } else {
                memcpy(d, "null", 4);
                d += 4;
            }
        }
        if (has_ctx) {
            snprintf(d, cap - (size_t) (d - out),
                     ",\"contextTrain\":%u}", ctx_len);
        } else {
            memcpy(d, ",\"contextTrain\":null}", 22); // 21 chars + NUL
        }
        free(name);
        free(arch);
        free(params);
        return out;
    }

fail:
    fclose(f);
fail2:
    free(name);
    free(arch);
    free(params);
    return NULL;
}

// feature 010: whole-ctx state save/load. lls_state_load also rebuilds
// the kv_tokens mirror from the tokens echoed by llama_state_load_file
// and resets pos, so a later lls_generate_continue LCP-resumes exactly
// at the saved turn boundary. Both are no-ops on inactive ctx only;
// callers must not invoke while generating.
int lls_state_save(lls_ctx * c, const char * path, char ** err) {
    if (c == NULL || path == NULL || path[0] == 0) {
        set_err(err, "bad args");
        return 1;
    }
    if (c->generating) {
        set_err(err, "generation in progress");
        return 1;
    }
    // mirror IS the session token list (prompt + generated, seq 0)
    if (!llama_state_save_file(c->handle, path, c->kv_tokens,
                               (size_t) c->kv_count)) {
        set_err(err, "state save failed");
        return 1;
    }
    return 0;
}

int lls_state_load(lls_ctx * c, const char * path, char ** err) {
    if (c == NULL || path == NULL || path[0] == 0) {
        set_err(err, "bad args");
        return 1;
    }
    if (c->generating) {
        set_err(err, "generation in progress");
        return 1;
    }
    llama_token * tokens =
        (llama_token *) malloc(sizeof(llama_token) * (size_t) c->kv_cap);
    if (tokens == NULL) {
        set_err(err, "out of memory");
        return 1;
    }
    size_t n_out = 0;
    if (!llama_state_load_file(c->handle, path, tokens,
                               (size_t) c->kv_cap, &n_out)) {
        free(tokens);
        set_err(err, "state load failed");
        return 1;
    }
    if (c->kv_tokens != NULL && n_out <= (size_t) c->kv_cap) {
        memcpy(c->kv_tokens, tokens, n_out * sizeof(llama_token));
        c->kv_count = (int32_t) n_out;
    } else {
        // mirror unavailable: force full-prefill semantics on continue
        c->kv_count = 0;
    }
    free(tokens);
    c->pos = (int32_t) n_out;
    c->n_gen = 0;
    return 0;
}
