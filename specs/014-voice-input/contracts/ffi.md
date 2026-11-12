# Contract: `whisper_shim` FFI ABI

New pull-based C11 shim, sibling to `llama_shim` — same ownership and
threading rules: all symbols called from one JS thread (the **stt
Worker**, not the main thread); caller-owned handles; `char** err`
out-params are shim-allocated and freed via `lws_free_string`.

Library: `libwhisper_shim.(so|dylib|dll)` in `native/out/<platform>/`,
dlopened by `src/bun/stt/ffi.ts` using the same dev/packaged path
resolution as `loadLlamaShim`.

```c
typedef struct lws_model lws_model;
typedef struct lws_ctx   lws_ctx;

// static string; never freed
LWS_API const char * lws_version(void);

// NULL on failure; err set (free via lws_free_string)
LWS_API lws_model * lws_model_load(const char * path, char ** err);
LWS_API void        lws_model_free(lws_model * m);          // NULL-safe

// one ctx per model; NULL on failure, err set
LWS_API lws_ctx * lws_ctx_create(lws_model * m, char ** err);
LWS_API void      lws_ctx_free(lws_ctx * c);                // NULL-safe

// transcription params; p == NULL selects defaults
// language: NULL or "" = auto-detect; ISO code otherwise
// n_threads: <=0 = whisper default
typedef struct lws_stt_params {
    const char * language;
    int32_t      n_threads;
} lws_stt_params;

// one-shot transcription of a whole clip.
// pcm: s16le, 16 kHz, mono; n_samples = sample count (not bytes)
// returns a shim-allocated NUL-terminated UTF-8 transcript
// ("" for silence/undecodable — never an error) or NULL on failure
// with err set. Free via lws_free_string either way.
LWS_API char * lws_transcribe(lws_ctx * c, const int16_t * pcm,
                              int32_t n_samples,
                              const lws_stt_params * p, char ** err);

LWS_API void lws_free_string(char * s);
```

Mapping notes for the C implementation:

- `lws_ctx_create` wraps `whisper_init_from_file_with_params`-style
  context init on the loaded model path (or `whisper_init_state` when
  separating model/state); `lws_transcribe` converts s16→f32 into a
  scratch buffer and calls `whisper_full` with a params struct built
  from `lws_stt_params`, then concatenates `whisper_full_get_segment_text`
  across `whisper_full_n_segments`.
- Shutdown order (mirrors llama_shim): `lws_ctx_free` → `lws_model_free`
  → worker exit.
- No `lls_step`-equivalent — transcription is not incremental (research
  D4/D5).

## Typed surface (`src/bun/stt/ffi.ts`)

`loadWhisperShim()` mirrors `loadLlamaShim()`: candidate paths =
`native/out/<platform>` (dev) then `<exe>/../Resources/app/native/
<platform>` (packaged); throws once with the tried paths. Symbols typed
via `FFIType`; `lws_transcribe`'s `pcm` arg crosses as `ptr` + `i32`.
