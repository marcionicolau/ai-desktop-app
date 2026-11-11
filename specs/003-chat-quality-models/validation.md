# Validation — Feature 003 (executed against real SmolLM2-135M)

Date: 2025-11-11 · model: `models/SmolLM2-135M-Instruct-Q4_K_M.gguf`

| Scenario | Result | Evidence |
|----------|--------|----------|
| VS-1.1 temp 0.9 ×2 → outputs differ | ✅ PASS | script: `temp09_differ: true` |
| VS-1.2 seed 42 + temp 0 ×2 → identical | ✅ PASS | `greedy_identical: true` |
| VS-1.3 maxTokens 32 → clean complete | ✅ PASS | `status: complete, tokens: 32` |
| VS-1 UI | ✅ PASS | live: settings gear → `59 tokens · 75.1 tok/s` |
| VS-2.1 warm turns in one conv | ✅ PASS | `t1 warm:false → t2,t3 warm:true` |
| VS-2.2 conv switch → cold fallback | ✅ PASS | `cold_fallback: true` (rc 2 → full decode) |
| VS-3.1 markdown + code block + copy | ✅ PASS | AiMessage/CodeBlock components; renderer build green |
| VS-3.2 regenerate last reply | ✅ PASS | rpc test: same messageId re-streams |
| VS-3.3 edit + resend | ✅ PASS | rpc test + live fix: `userMessageId` wired (was NOT_FOUND on optimistic ids) |
| VS-3.4 sidebar filter | ✅ PASS | `filter.trim()` title substring, live list |
| VS-3.5 stats under reply | ✅ PASS | `N tokens · X tok/s` (chat.done.stats) |
| VS-4.1 library lists .gguf + meta | ✅ PASS | `readGgufMeta`: llama / Q4_K_M / ctx 8192; tests 4/4 |
| VS-4.2 HF download → loads | ✅ PASS | real download: 105,454,432 B, 24 progress events, `done`, `.part`→rename, meta parses |
| VS-4.3 abort → `.part` removed | ✅ PASS | catch path unlinks `.part`; scan excludes `*.part` (test) |
| VS-4.4 per-model override | ✅ PASS | `model.setOverride` + INVALID_PARAMS guard; override editor UI |
| VS-5 gates | ✅ PASS | typecheck ✓ lint ✓ (0 warnings) tests 55/55 ✓ build:renderer ✓ build-native ✓ |

## Fixes found during validation

- `chat.edit` silently failed on fresh messages — optimistic renderer ids
  weren't backend-visible → `chat.send` now accepts `userMessageId`.
- `FFIType.ptr` NULL returns as `null` not `0` — `lls_gguf_meta` error path.
- Edit/regenerate RPC failures now surface to the error banner.
- Lint fully green: fixed useless-fallback spreads, `sort`→`toSorted`,
  `reverse`→`toReversed` (tsconfig bumped to ES2023), hoisted helpers,
  documented intentional patterns with `oxlint-disable` comments
  (sequential awaits in pull/step decode + budget retry, split ChatML
  literals, side-effectful `new`, placeholder `emit`).

## Method

- VS-1/VS-2: direct `LlamaEngine` script (`/tmp/validate-003.ts`).
- VS-4: real `model.download` handler invocation with `MODELS_DIR=/tmp`
  (downloaded + deleted 105 MB SmolLM2 Q4_K_M from HuggingFace).
- VS-3: 4 rpc contract tests + live UI checks across dev sessions.
