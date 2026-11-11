# Research: Chat Quality & Model Management — Decisions

## D1 — Sampler configuration ABI

**Decision**: `lls_generate_begin` gains a `const lls_gen_params*` arg (struct
by pointer; NULL = defaults). `lls_gen_params` carries `temperature`,
`top_p`, `top_k` (int32), `repeat_penalty`, `seed` (uint32),
`max_tokens` (int32; 0 = unlimited), `n_threads`, `n_gpu_layers` reserved.

**Rationale**: a struct keeps the ABI stable while the param surface grows —
no signature churn. NULL-means-defaults keeps the JS call simple.

**Alternatives**: one setter call per param (5+ symbols, chatty);
positional args (fragile, already caused count drift).

Sampler chain when params are non-default:
`min_p(0.05)` → `top_k` → `top_p` → `temp` → `penalties(repeat)` →
`dist(seed)`; greedy stays the default path (all-defaults shortcut) so the
existing lifecycle tests keep validating it.

## D2 — KV reuse via `lls_generate_continue`

**Decision**: new symbol `lls_generate_continue(ctx, prompt_delta, params,
err)` — identical to `begin` minus `llama_memory_clear` and minus BOS
(`add_special=false` on tokenize). Decodes only the delta tokens; `c->pos`
continues. The JS side decides reuse via a session fingerprint.

**Rationale**: llama.cpp's KV is append-only; `memory_clear` is only needed
when content diverges. Fingerprint = `(modelPath, conversationId,
turnsHash)` where `turnsHash` hashes the rendered prefix turn list. Any
mismatch → plain `generate_begin` (full decode). Correctness preserved by
construction: we never resume after truncation/edit/regenerate/model reload.

**Alternatives**: `llama_memory_seq_rm` surgical trimming (complex, fragile);
always full decode (status quo — slow).

## D3 — Real token counting

**Decision**: `lls_token_count(ctx_or_model, text) → int32` — calls
`llama_tokenize(vocab, text, len, NULL, 0, add_special, parse_special)`,
which returns the *negative* required count when the buffer is empty —
absolute value is the token count. No allocation needed.

**Rationale**: exact budgeting replaces `chars/4` (which the smoke test
proved undercounts ~2x on repetitive text). Estimate stays as fallback when
no model is loaded.

**Alternatives**: tokenize into a caller buffer (requires the buffer to
size first — same call, extra alloc for no gain).

## D4 — GGUF metadata without model load

**Decision**: `lls_gguf_meta(const char* path, char** err) → char*` — parses
the GGUF container header directly in the shim (magic/version/kv-count,
then the typed key-value pairs we need) and returns a JSON string allocated
by the shim (freed via `lls_free_string`).

**Rationale**: `llama_model_load_from_file` mmaps/inits the whole model to
read metadata — heavy for a library scan of N files. The GGUF header format
is stable and simple (uint32/64 counts + typed values); ~150 lines of C,
no new deps, <1 ms per file.

**Alternatives**: load model for meta then free (100–500 MB mmap per file,
slow); JS-side parsing in Bun (duplicates the binary format logic in a
second language — shim keeps format knowledge in one place).

## D5 — HuggingFace download in the Bun process

**Decision**: `model.download` handler streams `fetch()` → `Bun.write` via
`.part` suffix → atomic rename on completion; emits
`model.download { phase: progress|done|error, downloaded, total }`.
URL allowlist: `https://huggingface.co/*/resolve/*` ending `.gguf`.
Abort → `.part` deleted.

**Rationale**: Bun streams to disk without buffering; `.part`+rename reuses
the existing atomic-write pattern from the JSON store.

**Alternatives**: resume support (deferred — note in spec); delegated to
`curl`/`wget` subprocess (extra failure modes, no progress granularity).

## D6 — Settings schema

**Decision**: `Settings` gains `generation: GenerationParams` and
`modelOverrides: Record<string, Partial<GenerationParams>>` (keyed by model
file **basename** — survives path moves inside `models/`). Per-model wins
over global; missing keys inherit. Store validates/clamps at write
(`temperature 0–2`, `topP 0–1`, `topK ≥0`, `maxTokens ≥0`).

**Rationale**: basename keying is human-readable and survives the picker
returning different absolute paths; merge is one shallow spread — no
deep-merge machinery needed.

## D7 — Prompt assembly extracted to `prompt.ts`

**Decision**: pure function `buildPrompt(history, current, opts {chatml,
budgetChars})` returning `{prompt, turns, truncated}` — lifted out of
`handlers.ts` unchanged in semantics (ChatML vs plain, oldest-turn drop,
current-message-always-kept).

**Rationale**: the smoke-test retry logic made the handler the most
entangled code in the repo; a pure function is unit-testable without RPC
fixtures and lets US2's delta-prompt builder share the formatter.

## D8 — Session fingerprint & stats plumbing

**Decision**: engine keeps `session: {modelPath, convId, turnsHash, pos}`
as JS metadata (no native handle); `generate` returns
`{status, tokens, elapsedMs}` → `chat.done` gains `{stats}`; Message gains
optional `stats {tokens, tokensPerSec}` persisted with the turn.

**Rationale**: fingerprint invalidation is the only safe reuse rule;
stats are display-only and ride existing events — no new transport.

**Alternatives**: native-side session registry (more C state to manage);
stats via a separate `chat.stats` event (unnecessary second round-trip).
