# Quickstart: Desktop AI Chat — Validation Guide

## Prerequisites

- Bun (runtime + tooling), CMake ≥ 3.14, and a C/C++ toolchain per OS
  (GCC/Clang on Linux/macOS, MSVC 2022 or clang-cl on Windows).
- A compatible local model file (e.g., a small GGUF model) somewhere on disk.

## Build

```bash
bun install                        # JS deps
./scripts/build-native.sh          # Linux/macOS — or build-native.ps1 on Windows
                                   # produces native/out/<platform>/libllama_shim.* + deps
bun run build:renderer             # vite build → dist/renderer/
bun run dev                        # hutch dev → vite :5173 + electrobun dev --watch
```

Packaged check: `bun run build` (hutch run build → electrobun build
--env=canary) → bundle in `build/canary-<platform>/`; native libs land in
`Resources/app/native/<platform>/`.

## Validation scenarios

Each maps to a spec user story / success criterion.

### VS-1 — Streaming chat (US1, SC-001/002/003/006)

1. Disconnect from the network (offline check).
2. Launch the app → Settings/model picker → select the model file →
   expect `model.progress` → `ready`.
3. Send "Explain photosynthesis in two sentences."
   - Expect: first visible text ≤ 3s; `chat.token` deltas render
     incrementally; `chat.done` with `status=complete`.
4. Send a second prompt and click **Stop** mid-generation.
   - Expect: output halts ≤ 1s; message saved as `status=partial`;
     `chat.done` with `status=partial`.

### VS-2 — Persistence (US2, SC-004)

1. Create two conversations; send a message in each.
2. Quit the app completely; relaunch.
   - Expect: both conversations listed via `conversation.list`; all
     messages intact including the partial one.
3. Delete one conversation (confirm prompt) → it's gone after relaunch.

### VS-3 — Model errors (US3, FR-006/FR-007)

1. Select a corrupt/empty file as the model.
   - Expect: `model.progress` → `error` with human-readable message; chat
     input disabled; app stable.
2. Select the valid model again → `ready`; existing history unaffected.

### VS-4 — Busy/edge behavior (FR-011/FR-012)

1. While generation is in flight, attempt `chat.send` → rejected with
   `ENGINE_BUSY`; UI shows the explain state.
2. Paste a very long document → send accepted, or clear limit warning shown.

## Automated checks

- `bun run typecheck` (strict `tsc --noEmit`) — must pass.
- `bun test` — includes FFI lifecycle test: load → generate N tokens → stop →
  free ctx → free model → `close()` → reload (ffi.md ownership rules).
- `vite build` — release-blocking if broken (constitution Principle V).
