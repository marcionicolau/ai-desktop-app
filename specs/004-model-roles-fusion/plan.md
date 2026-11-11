# Implementation Plan: Tagged Model Roles & Planner–Executor Fusion

**Branch**: `004-model-roles-fusion` | **Date**: 2025-11-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-model-roles-fusion/spec.md`

## Summary

Introduce a tag indirection layer ("code knows aliases, never filenames" —
the LiteLLM lesson): `ModelTag`s bound to local GGUFs resolve at generation
time through a `RoleResolver`, with per-tag param overrides and ordered
fallback chains. A `ModelRegistry` owns loaded model slots keyed by
normalized path (shared slots satisfy FR-011: two roles on one file = one
load). Fusion mode is a sequential two-phase pipeline
(`FusionOrchestrator`: planner → executor) reusing the existing
single-flight turn gate and per-ctx KV mirror. All managed from a new Roles
UI surface plus chat-side fusion controls.

## Technical Context

**Language/Version**: TypeScript strict (Bun 1.4.x), C11 for the shim (no ABI change needed)

**Primary Dependencies**: Electrobun 2.0.6, `bun:ffi`, React 19, Tailwind v4, shadcn/ui — **no new runtime dependencies**

**Storage**: existing JSON store (`settings.json` gains `tags`/`roleBindings`; `Conversation` gains fusion fields)

**Testing**: `bun test ./tests` — new suites under `tests/roles`, `tests/llama`, `tests/rpc`

**Target Platform**: desktop (Linux primary; shim stays portable C)

**Project Type**: desktop-app

**Performance Goals**: fusion turn planner phase ≤ small model budget; warm-turn KV reuse preserved per ctx; ≤2 resident model instances

**Constraints**: ≤2 loaded ctxs (memory), sequential phases (single-flight), offline-only, typed RPC boundary

**Scale/Scope**: ~12 new files, ~10 modified, ~4 new test files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Note |
|---|---|---|
| I. Local-first via llama.cpp/FFI | ✅ | multi-model = more `lls_ctx` handles; no cloud/N-API |
| II. Electrobun boundaries, typed RPC | ✅ | all new UI↔main traffic via `role.*`/events in one contract |
| III. Strict TS + typed FFI | ✅ | no new FFI symbols; handle types already `ptr` |
| IV. shadcn/ui + Tailwind v4 | ✅ | Roles UI composed from existing components |
| V. Vite pipeline | ✅ | renderer additions only |
| VI. Minimal deps | ✅ | zero new dependencies |

**Post-Phase-1 re-check**: PASS — no violations, nothing for Complexity Tracking.

## Design Highlights

*(User-requested dimensions: memory efficiency, speed, maintainability, design patterns)*

- **Memory**: `ModelRegistry` dedups slots by resolved file path (FR-011
  single instance); policy `MAX_SLOTS = 2` with explicit eviction on
  rebinding; planner/executor never run concurrently, so peak decode memory
  stays single-ctx.
- **Speed**: sequential phases reuse each ctx's token-mirror KV
  (`lls_generate_continue`) across turns; planner prompt is budget-capped;
  executor prompt injects plan inline (no second tokenizer pass over chat
  history beyond the normal budgeting path).
- **Maintainability**: role logic isolated in `models/roles.ts`
  (persistence+validation) and `llama/fusion.ts` (pipeline); handlers stay
  thin — `streamAssistant` gains one branch that delegates to the
  orchestrator. DI seams (`EngineLike`, `StoreLike`) extended, not broken.
- **Patterns** (see research.md): Registry, Chain-of-Responsibility
  (fallbacks), Strategy (param merge cascade), State Machine (fusion
  phases), Indirection/Alias (tags).

## Project Structure

### Documentation (this feature)

```text
specs/004-model-roles-fusion/
├── plan.md              # This file
├── research.md          # Phase 0: design decisions D1–D9
├── data-model.md        # Phase 1: entities & persistence shapes
├── quickstart.md        # Phase 1: validation scenarios VS-1…VS-6
├── contracts/
│   ├── rpc.md           # role.* requests, conversation.setMode, phase events
│   └── ffi.md           # multi-handle ownership notes (no new symbols)
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── bun/
│   ├── models/
│   │   ├── library.ts        # (existing) GGUF scan/download
│   │   ├── roles.ts          # NEW — ModelTag CRUD, bindings, fallback chains,
│   │   │                     #      slug validation, persistence shape
│   │   └── registry.ts       # NEW — ModelRegistry: path→ModelSlot map, shared
│   │                         #      loads, MAX_SLOTS=2 eviction, busy guards
│   ├── llama/
│   │   ├── engine.ts         # (existing) → becomes per-slot EngineInstance
│   │   ├── ffi.ts            # (existing) unchanged — handles already per-ptr
│   │   ├── params.ts         # (existing) mergeParams reused for tag cascade
│   │   ├── prompt.ts         # (existing) chat prompt builder
│   │   ├── plan-prompt.ts    # NEW — planner template + executor plan-injection
│   │   └── fusion.ts         # NEW — FusionOrchestrator: plan→answer phases,
│   │                         #      stop-at-boundary, per-phase stats
│   ├── rpc/handlers.ts       # role.* requests, conversation.setMode, fusion
│   │                         # branch inside streamAssistant
│   ├── store/json-store.ts   # settings schema: tags + conversation fusion
│   └── index.ts              # wire registry/roles into handler deps
├── shared/
│   ├── types.ts              # ModelTag, TagBinding, RoleState, FusionPhase,
│   │                         # PhaseStats, Conversation.fusion fields
│   └── rpc-contract.ts       # role.* + setMode + chat.phase + chat.token{phase}
└── renderer/src/
    ├── features/
    │   ├── roles/
    │   │   ├── RolesPanel.tsx      # NEW — tag list, states, bind, fallbacks
    │   │   ├── TagEditor.tsx       # NEW — name/label/params/fallback editor
    │   │   └── use-roles.ts        # NEW — role.* RPC hook
    │   ├── models/
    │   │   └── ModelLibrary.tsx    # extend — "download & bind to tag" select
    │   ├── chat/
    │   │   ├── FusionControls.tsx  # NEW — mode toggle + planner/executor picks
    │   │   ├── ChatPage.tsx        # integrate controls + roles entry point
    │   │   ├── MessageList.tsx     # collapsible Plan block + per-phase stats
    │   │   └── use-chat.ts         # phase-aware token routing, fusion flow
    │   └── settings/GenerationSettings.tsx  # reused for per-tag overrides
    └── components/ai/              # ai-message renders plan section

tests/
├── roles/
│   ├── roles.test.ts           # tag CRUD, slug validation, binding states
│   └── registry.test.ts        # shared slots, eviction, busy guards
├── llama/
│   ├── fusion.test.ts          # 2-phase flow, stop-at-boundary, fallback
│   └── plan-prompt.test.ts     # template + injection builders
├── rpc/
│   ├── role.test.ts            # role.* contract + error codes
│   └── fusion.test.ts          # setMode gating, fusion send path, events
└── store/json-store.test.ts    # extended settings/conversation round-trip
```

**Structure Decision**: extend the existing `src/bun` + `src/shared` +
`src/renderer` tri-process layout. New modules colocate by concern —
`models/` owns persistence-facing role data, `llama/` owns the generation
pipeline, `features/roles/` owns the new UI surface. No new top-level
directories, no new process boundaries.

## Complexity Tracking

No constitution violations — table intentionally empty.
