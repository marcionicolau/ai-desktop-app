# Implementation Plan: Desktop AI Chat

**Branch**: `001-desktop-ai-chat` | **Date**: 2026-11-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-desktop-ai-chat/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

A multi-OS Electrobun desktop app offering real-time AI chat with token-level
streaming. The React/Vite renderer talks to the Bun main process over a typed
RPC contract; the main process drives local llama.cpp inference through a thin
C shim (`llama_shim`) loaded via Bun FFI. Conversations persist to a local JSON
store. See `research.md` for bundling, per-OS native builds, FFI memory
management, and streaming transport decisions.

## Technical Context

**Language/Version**: TypeScript (strict) on Bun ≥ 1.1; C11 for `llama_shim`;
C++17 inside vendored llama.cpp.

**Primary Dependencies**: Electrobun (shell + RPC bridge + bundling),
Vite + React + Tailwind CSS v4 + shadcn/ui (renderer), `bun:ffi` + llama.cpp
(inference).

**Storage**: JSON document store in the OS user-data directory
(`Utils.paths.userData`) — conversations/messages; small settings file for
`activeModelPath`.

**Testing**: `bun test` — unit tests (store, contract), FFI lifecycle
integration tests (load/generate/stop/free/reload), renderer tests via
contract mocks.

**Target Platform**: Windows x64/ARM64, macOS arm64/x64 (14+), Linux x64 —
per Electrobun host-native build matrix.

**Project Type**: desktop-app.

**Performance Goals**: first visible token ≤ 3s on mid-range CPU; continuous
stream updates (< 1s perceived stalls); stop acknowledged ≤ 1s.

**Constraints**: fully offline chat; bun:ffi is experimental → thin FFI
surface + lifecycle tests mandated; no N-API/node-gyp (constitution).

**Scale/Scope**: single-window chat app — 10 RPC methods + 4 events, 8 FFI
symbols (pull-based step loop, no cross-thread callbacks), 3 OS targets.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Evidence |
|-----------|---------|----------|
| I. Local-First Inference (llama.cpp via Bun FFI, no cloud/N-API) | PASS | `llama_shim` C shim + `dlopen`; cloud APIs absent from design (research.md D1–D3, D5) |
| II. Electrobun Process Boundaries (typed RPC contracts in shared location) | PASS | `contracts/rpc.md`; shared defs in `src/shared/` (research.md D4) |
| III. Strict TypeScript & Typed FFI (declared signatures, validated data) | PASS | `contracts/ffi.md` — plain-C surface, explicit ownership rules, `strict` tsconfig gate (research.md D5) |
| IV. Component Standardization (shadcn/ui + Tailwind v4 CSS-first) | PASS | renderer built via Vite with Tailwind v4 `@theme`; no competing UI libs (research.md D6) |
| V. Vite Build Pipeline (vite build + HMR healthy) | PASS | Vite owns renderer build; dev mode uses Vite dev-server for HMR (research.md D6) |
| VI. Minimal Dependencies | PASS | deps = declared stack only; JSON store over SQLite/ORM (no extra dep for 3 small entities) |

**Pre-Phase-0 gate**: PASS. **Post-Phase-1 re-check**: PASS — design artifacts
introduce no new dependencies, no IPC outside the contract layer, no
component-library imports outside shadcn/ui.

## Project Structure

### Documentation (this feature)

```text
specs/001-desktop-ai-chat/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (rpc.md, ffi.md)
├── checklists/          # requirements.md (/speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── shared/                  # imported by both processes
│   ├── rpc-contract.ts      # method/event schemas (contracts/rpc.md)
│   └── types.ts             # Conversation, Message, ModelStatus
├── bun/                     # main process (electrobun entrypoint)
│   ├── index.ts             # app bootstrap, window, RPC registration
│   ├── rpc/handlers.ts      # model.*, chat.*, conversation.*
│   ├── llama/
│   │   ├── ffi.ts           # dlopen + symbol declarations (contracts/ffi.md)
│   │   └── engine.ts        # typed wrapper: load/free/generate/stop, dispose()
│   └── store/
│       ├── json-store.ts    # persistence in userData dir
│       └── paths.ts
├── renderer/                # Vite + React app (built to dist/renderer/)
│   ├── index.html
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── components/ui/   # shadcn/ui
│       ├── features/chat/   # message list, composer, stream reducer
│       ├── features/models/ # model picker + status
│       └── lib/rpc.ts       # typed client for rpc-contract.ts
└── native/
    ├── shim/
    │   ├── llama_shim.c     # C ABI surface (contracts/ffi.md)
    │   ├── llama_shim.h
    │   └── CMakeLists.txt
    └── vendor/llama.cpp/    # git submodule, pinned tag

scripts/
├── build-native.sh          # Linux/macOS: cmake -DBUILD_SHARED_LIBS=ON
├── build-native.ps1         # Windows: MSVC/clang-cl, same flags
└── stage-native.ts          # copies libs → native/out/<platform>/ for dev
                             # and into bundle resources for builds

native/out/<platform>/       # build artifacts (.so/.dylib/.dll + ggml deps)
electrobun.config.ts         # bun entrypoint, views/copy rules, release cfg
hutch.config.ts              # dev/build scripts
```

**Structure Decision**: Single project, three lanes — `src/bun` (main),
`src/renderer` (webview), `src/native` (C shim + vendored llama.cpp) —
with `src/shared` holding the contract imported by both sides per
constitution Principle II. Native artifacts are staged per-OS under
`native/out/<platform>/` and copied into `Resources/app/native/` at bundle
time via `electrobun.config.ts` `build.copy`.

## Complexity Tracking

No constitution violations — section not applicable.
