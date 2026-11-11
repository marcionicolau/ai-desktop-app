# Tasks: Chat Quality & Model Management

**Input**: Design documents from `/specs/003-chat-quality-models/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Organization**: Tests included — SC-005 requires new suites and prior
features established test-first conventions.

## Phase 1: Setup

- [x] T001 Add renderer deps `react-markdown`, `remark-gfm`, `rehype-highlight` via `bun add` in `src/renderer/package.json` (or root if hoisted)
- [x] T002 [P] Scaffold directories: `src/bun/models/`, `src/renderer/src/components/ai/`, `src/renderer/src/features/settings/`

## Phase 2: Foundational (Blocking Prerequisites)

**CRITICAL**: all stories consume the params struct, prompt module, settings schema, and extended contract.

- [x] T003 Add `lls_gen_params` struct to `src/native/shim/llama_shim.h`; change `lls_generate_begin` signature to accept `const lls_gen_params* p` (NULL = current defaults: greedy + 512-token cap honoring `LLS_MAX_GEN`); implement sampler chain in `llama_shim.c` (`min_p→top_k→top_p→temp→penalties→dist(seed)`; keep greedy shortcut when all-defaults)
- [x] T004 Update `src/bun/llama/ffi.ts`: declare `lls_gen_params` layout + new `generate_begin` signature; expose `params` arg through the engine-facing wrapper
- [x] T005 Create `src/bun/llama/params.ts`: `GenerationParams` type (temperature 0–2, topP 0–1, topK ≥0, repeatPenalty ≥0 [1=off], seed uint32 [0=random], maxTokens ≥0 [0=ctx-bound], nThreads ≥0, nGpuLayers ≥0), `DEFAULT_PARAMS` matching current behavior, `mergeParams(base, override)`, `clampParams` validation
- [x] T006 Extract prompt assembly from `src/bun/rpc/handlers.ts` into new `src/bun/llama/prompt.ts`: pure `buildPrompt(history, current, {chatml, budgetChars})` → `{prompt, turns, truncated}` preserving exact current semantics (ChatML when template has `im_start`, oldest-turn drop, current message always kept)
- [x] T007 Extend `src/shared/types.ts` (`GenerationParams`, `Message.stats`) and `src/shared/rpc-contract.ts` per `contracts/rpc.md`: methods `settings.get`, `settings.set`, `chat.regenerate`, `chat.edit`, `model.list`, `model.download`, `model.setOverride`; event `model.download`; `chat.done` gains `stats`; error codes `INVALID_PARAMS`, `INVALID_URL`, `DOWNLOAD_FAILED`, `ALREADY_EXISTS`
- [x] T008 Extend `src/bun/store/json-store.ts` Settings: `generation: GenerationParams`, `modelOverrides: Record<string, Partial<GenerationParams>>` keyed by file basename; add `deleteMessagesFrom(convId, messageId)` and `updateMessage(id, {content?, stats?, status?})`; clamp/validate params at write
- [x] T009 Rebuild native (`bash scripts/build-native.sh`) + run `bun test ./tests` — all 32 existing tests must still pass unmodified (proves ABI change is backward-safe)

**Checkpoint**: params struct compiles, prompt module pure, settings persist, contract types complete.

## Phase 3: US1 — Tuned Generation (P1) 🎯 MVP

**Goal**: per-request sampling params + generation limits from settings.

**Independent Test**: VS-1 — temp>0 twice → different outputs; seed+temp0 → identical; maxTokens=32 → clean stop.

- [x] T010 [P] [US1] Write `tests/ffi/params.test.ts`: seed reproducibility (same seed+params → same output), maxTokens respected, NULL/defaults = greedy (skip if no test model — guard like existing ffi tests)
- [x] T011 [US1] Update `src/bun/llama/engine.ts`: `generate(prompt, params, onToken)` applies `GenerationParams`; return `{status, tokens, elapsedMs}`
- [x] T012 [US1] Update `src/bun/rpc/handlers.ts`: implement `settings.get`/`settings.set` (+`INVALID_PARAMS` on out-of-range); resolve params `defaults ← settings.generation ← modelOverrides[basename]` at `model.load`/`chat.send`; include `stats` in `chat.done`
- [x] T013 [US1] Create `src/renderer/src/features/settings/GenerationSettings.tsx`: inputs/sliders for the 8 params (labels + range hints from data-model.md); wire `settings.get`/`settings.set` in `use-chat.ts`; show `Message.stats` under assistant replies

**Checkpoint**: US1 shippable alone — sampler controls work end-to-end.

## Phase 4: US2 — Fast Multi-Turn (P2)

**Goal**: KV reuse across turns + real token budgeting.

**Independent Test**: VS-2 — turn ≥2 TTFT visibly lower; truncation/switch triggers clean full-decode fallback.

- [x] T014 [P] [US2] Write `tests/bun/prompt.test.ts`: `buildPrompt` formats (chatml/plain), oldest-turn drop, delta-prompt extraction for continue path
- [x] T015 [US2] Add to shim + ffi.ts: `lls_generate_continue(ctx, prompt_delta, params, err)` (no `memory_clear`, `add_special=false`) and `lls_token_count(ctx, text) → int32` (NULL-buffer `llama_tokenize`); declare in `llama_shim.h`
- [x] T016 [US2] Implement `KVSession` in `engine.ts`: `{modelPath, conversationId, turnsHash, kvPos}`; `generate` chooses continue vs begin by fingerprint match; invalidate on conv switch, model unload, truncation, regenerate/edit, restart; expose `warm` flag for tests
- [x] T017 [US2] Update `handlers.ts` `chat.send`: replace `chars/4` estimate with `lls_token_count` budgeting (fallback to estimate when no model loaded); keep retry-on-overflow as safety net; pass `conversationId` so engine can fingerprint

**Checkpoint**: US1+US2 both working; warm turns measurably faster (SC-002).

## Phase 5: US3 — Rich Chat Surface (P3)

**Goal**: markdown/code rendering, message actions, sidebar filter, stats.

**Independent Test**: VS-3 — code block renders highlighted + copies raw; regenerate streams in place; edit deletes tail; filter narrows list.

- [ ] T018 [P] [US3] Create `src/renderer/src/components/ai/`: `ai-message.tsx` (react-markdown + remark-gfm + rehype-highlight rendering `Message.content`), `code-block.tsx` (hljs styling + copy button per shadcn conventions), `message-actions.tsx` (copy / regenerate / edit icons via Radix `Tooltip`/`Popover` per existing component patterns)
- [ ] T019 [US3] Implement `chat.regenerate` in `handlers.ts`: target last `complete|partial` assistant turn → reset `generating`, clear content, rerun generation with same `messageId`; invalidate KVSession; `NOT_FOUND`/`ENGINE_BUSY` semantics per contract
- [ ] T020 [US3] Implement `chat.edit` in `handlers.ts`: validate non-empty (`EMPTY_MESSAGE`), update user msg content, `deleteMessagesFrom` the following turn onward, then run the normal send/generate flow; invalidate KVSession
- [ ] T021 [US3] Wire renderer: `MessageList` → `ai-message`; actions call `chat.regenerate`/`chat.edit`; sidebar `Input` filter on conversation title substring (case-insensitive); stats line under finished replies

**Checkpoint**: US1–US3 functional; chat UX complete.

## Phase 6: US4 — Model Library & Downloads (P4)

**Goal**: GGUF metadata catalog + HF downloads + per-model params.

**Independent Test**: VS-4 — `models/` files listed with metadata; HF URL downloads with progress; `.part` cleaned on failure.

- [ ] T022 [P] [US4] Add `lls_gguf_meta(path, err) → char*` (JSON) to shim — header-only GGUF parse (name, architecture, paramCount, quantization, contextTrain); write `tests/ffi/gguf-meta.test.ts` against `models/SmolLM2-135M-Instruct-Q4_K_M.gguf`
- [ ] T023 [US4] Create `src/bun/models/library.ts`: scan `models/` for `.gguf`, call `lls_gguf_meta` per file → `ModelMeta[]`; exclude `.part`; write `tests/models/library.test.ts`
- [ ] T024 [US4] Implement `model.download` in `handlers.ts`: allowlist `huggingface.co/*/resolve/*.gguf` (`INVALID_URL` otherwise); stream `fetch` → `{fileName}.part` → atomic rename (`ALREADY_EXISTS` if target exists); emit `model.download` progress/done/error events; abort → delete `.part`
- [ ] T025 [US4] Create `src/renderer/src/features/models/ModelLibrary.tsx`: meta table + download form + load action (reuse `model.pick`/`model.load`); per-model override editor wired to `model.setOverride`

**Checkpoint**: all four stories functional.

## Phase 7: Polish & Cross-Cutting

- [ ] T026 Full gates: `bun run typecheck`, `bun run lint`, `bun test ./tests`, `bun run build:renderer`, native rebuild — all green (SC-005)
- [ ] T027 Execute `quickstart.md` VS-1…VS-5 against the running dev app; record results in `specs/003-chat-quality-models/validation.md`
- [ ] T028 Update `AGENTS.md` with new modules (`llama/prompt.ts`, `llama/params.ts`, `models/library.ts`, `components/ai/`) and new RPC surface

---

## Dependencies & Execution Order

- **Phase 1→2**: sequential (Setup before Foundational)
- **Phase 2 blocks all stories** — T003–T009 must complete first
- **US2 depends on US1** (params in `generate` signature) — not fully independent; US3/US4 only need Phase 2
- **US3 & US4 parallelizable** after Phase 2 (different files: renderer/store vs shim/models)
- Within stories: test task [P] first, then shim → engine → handlers → renderer

### Parallel opportunities

- T001+T002 (setup)
- T010 (test) while T011 builds
- T018 (components) while T019/T020 (handlers) build
- T022+T023 (meta) while T024 (download) builds
- US3 and US4 as whole-story streams

## Implementation Strategy

**MVP**: Phase 1+2+3 → sampling controls end-to-end (US1 alone is demoable).
**Incremental**: US1 → US2 (speed) → US3 (UX) → US4 (library), each gated
by its quickstart scenario.
