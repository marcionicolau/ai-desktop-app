# Implementation Plan: Chat Quality & Model Management

**Branch**: `003-chat-quality-models` | **Date**: 2025-11-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-chat-quality-models/spec.md`

## Summary

Extend the existing pull-based FFI shim with a generation-parameter struct
(sampling + bounds), a continue-path that reuses KV across turns, real
tokenization for budgeting, and GGUF metadata parsing; extend RPC with
settings, regenerate/edit, and model-library/download methods; extend the
renderer with a markdown/code AI-message surface, message actions, sidebar
filter, stats display, and a model library panel. All work stays inside the
established boundaries: thin C ABI, typed RPC, pull-only (no callbacks),
JSON persistence.

## Technical Context

**Language/Version**: TypeScript strict on Bun ≥1.4; C11 shim (vendored
llama.cpp unchanged).

**Primary Dependencies**: existing stack + `react-markdown`, `remark-gfm`,
`rehype-highlight` (renderer-only additions).

**Storage**: `settings.json` extended (`generation` params, `modelOverrides`);
GGUF files in `models/`; download temp `.part` files.

**Testing**: `bun test ./tests` — new suites: params plumbing, KV-reuse,
regenerate/edit, gguf-meta, prompt assembly, download state.

**Target Platform**: linux-x64 verified; win/mac scripts unchanged.

**Performance Goals**: warm-turn TTFT ≤30% of cold decode (SC-002); GGUF
meta parse <50 ms per file (header-only read, no model load).

**Constraints**: pull-based FFI (no threads/callbacks); KV reuse must never
produce corrupted context — fingerprint-gated with full-decode fallback;
single-flight generation preserved.

**Scale/Scope**: ~12 files touched, ~8 new files, 6 new FFI symbols,
~8 new RPC methods/events, 4 user stories.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Evidence |
|-----------|---------|----------|
| I. Local-First Inference | PASS | All work is local; HF download is user-initiated fetch of a local artifact |
| II. Electrobun Boundaries | PASS | New UI talks main only via typed RPC additions |
| III. Strict TS & Typed FFI | PASS | Params struct declared in `ffi.ts`; contracts updated first |
| IV. shadcn + Tailwind v4 | PASS | AI components follow existing component conventions |
| V. Vite Build Pipeline | PASS | Renderer deps added via package.json only |
| VI. Minimal Dependencies | WARN-OK | +3 renderer deps (markdown pipeline) — justified by FR-006; no new native/runtime deps |

**Pre-Phase-0 gate**: PASS. **Post-Phase-1 re-check**: PASS — no violations;
the markdown dependency set is the minimum standard trio.

## Project Structure

### Documentation (this feature)

```text
specs/003-chat-quality-models/
├── spec.md
├── plan.md              # this file
├── research.md          # 8 decisions (D1–D8)
├── data-model.md        # GenParams, ModelMeta, KVSession, DownloadState
├── quickstart.md        # VS-1..VS-5 validation
├── contracts/
│   ├── ffi.md           # ABI delta (new symbols + params struct)
│   └── rpc.md           # RPC delta (methods/events/schema changes)
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
src/native/shim/
├── llama_shim.h         # + lls_gen_params struct, +5 symbols
└── llama_shim.c         # sampler chain, continue-decode, tokenize, gguf meta

src/bun/
├── llama/
│   ├── ffi.ts           # + new symbol decls
│   ├── engine.ts        # params-aware generate, KV session, stats
│   ├── prompt.ts        # NEW: extracted prompt assembly (chatml/plain, turns)
│   └── params.ts        # NEW: GenParams types + defaults/merge
├── models/
│   └── library.ts       # NEW: scan models/, parse meta via shim, HF download
├── store/json-store.ts  # Settings schema extension
└── rpc/handlers.ts      # settings.get/set, chat.regenerate, chat.edit,
                         # model.list, model.download, stats in chat.done

src/shared/
├── types.ts             # GenParams, ModelMeta, DownloadState, stats on Message
└── rpc-contract.ts      # method/event additions

src/renderer/src/
├── components/ai/       # NEW: ai-message.tsx (markdown+actions),
│                        #      code-block.tsx, message-actions.tsx
├── components/ui/       # + input already exists; maybe dialog/popover
└── features/
    ├── chat/            # MessageList→AI message, Sidebar filter input,
    │                    # use-chat: regenerate/edit actions, stats, settings
    ├── models/          # ModelLibrary.tsx + download form + meta table
    └── settings/        # NEW: GenerationSettings.tsx (sliders/inputs)

tests/
├── ffi/params.test.ts       # sampler params applied; seed reproducibility
├── ffi/gguf-meta.test.ts    # meta JSON on real GGUF
├── rpc/regenerate.test.ts   # regenerate + editAndResend contracts
├── rpc/settings.test.ts     # settings round-trip + param validation
├── bun/prompt.test.ts       # prompt assembly + truncation (pure)
└── models/library.test.ts   # scan + partial-download cleanup
```

## Development Strategy

**Layered, inside-out, one story at a time — but shared groundwork first.**

Phase A (Foundational, blocks everything):
1. FFI params struct + sampler chain (D1) — extends generate_begin; the
   512-cap becomes `maxTokens` param with 0 = no cap.
2. `prompt.ts` extraction (D7) — pure function, unit-tested before use.
3. Settings schema + `params.ts` merge helper (D6).

Then per story, each independently shippable:

- **US1 (P1)**: engine.generate(params) → settings.get/set RPC →
  GenerationSettings UI. Verification: seed reproducibility test + manual A/B.
- **US2 (P2)**: `lls_generate_continue` + `lls_token_count` + KVSession
  fingerprint in engine (D2/D3/D8). Verification: timing test cold vs warm.
- **US3 (P3)**: renderer-only mostly; markdown deps + components/ai; RPC
  `chat.regenerate`/`chat.editAndResend` (delete-tail semantics in store);
  stats ride `chat.done`. Verification: contract tests + UI checks.
- **US4 (P4)**: `lls_gguf_meta` + `models/library.ts` + `model.download`
  (Bun fetch → `.part` → rename) + library UI. Verification: fixture GGUF
  meta test + small real download.

**Memory discipline** (per constitution): only `lls_gguf_meta` allocates a
string (freed via `lls_free_string`); continue-path reuses the same
`llama_context` — no extra allocations; KV session is metadata-only on the
JS side (no native duplication); downloads stream to disk (no full-file
buffers in JS).

**Design patterns**: params-as-struct ABI (extensible without signature
churn); engine façade unchanged outward; prompt assembly = pure function;
KVSession = opaque session descriptor with explicit invalidation;
store-level `deleteMessagesFrom(id)` primitive powers both regenerate and
edit (single mutation path).
