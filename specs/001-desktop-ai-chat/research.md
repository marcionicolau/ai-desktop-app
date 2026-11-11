# Research: Desktop AI Chat

Phase 0 output — resolves all technical unknowns for the plan.

## Decision 1: Native library distribution — thin C shim over llama.cpp

- **Decision**: Build a thin C shim library (`llama_shim`) that wraps the
  llama.cpp C API (`llama.h`) and exposes a small, FFI-friendly surface.
  Compile it per OS into `libllama_shim.{so,dylib}` / `llama_shim.dll`,
  linking against llama.cpp shared libs.
- **Rationale**: The raw `llama.h` API is large and exposes structs, batch
  arrays, and sampler chains that are painful to bind correctly through
  `bun:ffi`. A shim flattens the surface to opaque handles + plain C types +
  a stepped token-pull API (see Decision 5), keeps all memory-ownership rules
  in one auditable C file, and lets llama.cpp upgrades land behind a stable
  ABI.
- **Alternatives considered**:
  - Direct `bun:ffi` binding of `llama.h` — rejected: too many symbols and
    struct layouts to marshal; every API change ripples into TS.
  - Node-API addon — rejected: prohibited by constitution (no N-API/node-gyp).
  - `llama-server` subprocess — rejected: adds a network loopback and a second
    process to supervise; in-process FFI is the constitutional mandate.

## Decision 2: Per-OS dynamic library builds

- **Decision**: Vendor llama.cpp as a git submodule (`src/native/vendor/
  llama.cpp`, pinned tag). CMake builds it with `BUILD_SHARED_LIBS=ON`,
  `LLAMA_BUILD_SERVER=OFF`, `LLAMA_BUILD_TOOLS=OFF`, plus our `llama_shim`
  target. A `scripts/build-native.{sh,ps1}` pair produces per-OS artifacts:
  - Linux: `libllama_shim.so` + `libllama.so` + `libggml*.so` (system GCC/Clang)
  - macOS: `*.dylib` set, `@rpath`-relative install names, universal or per-arch
    (arm64 + x64 builds; macOS 14+ per Electrobun host matrix)
  - Windows: `llama_shim.dll` + `llama.dll` + `ggml*.dll` (MSVC 2022 or
    clang-cl; no MinGW — `BUILD_SHARED_LIBS` defaults OFF there)
- **Rationale**: `BUILD_SHARED_LIBS=ON` is upstream's native path (default on
  all non-MinGW/WASM targets). Shipping a fixed set of DLLs alongside the
  shim avoids depending on system-installed llama builds.
- **Alternatives considered**:
  - Static-link everything into one shim per OS — viable follow-up, but shared
    libs keep the first version simpler to debug and match upstream defaults.
  - Download prebuilt llama binaries — rejected: unverifiable provenance and
    version drift against our shim ABI.

## Decision 3: Loading native libs at runtime

- **Decision**: `bun:ffi` `dlopen()` with `suffix` from `bun:ffi`
  (`"dll" | "dylib" | "so"`) over an absolute path resolved from the app
  resources directory (`Resources/app/native/<platform>/` in packaged builds;
  `native/out/<platform>/` in dev). Libraries are copied into the bundle via
  Electrobun `build.copy`.
- **Rationale**: `dlopen` + `suffix` is the documented Bun mechanism for
  cross-platform library resolution; keeping native deps in `Resources/`
  means no reliance on system library paths (`LD_LIBRARY_PATH`, `PATH`,
  code-signing of third-party dylibs aside).
- **Alternatives considered**: bare library names relying on OS search paths —
  rejected, fragile across OSes and breaks packaged app sandboxing/signing.

## Decision 4: Streaming transport — Electrobun built-in RPC with events

- **Decision**: Use Electrobun's native main↔webview RPC bridge. Requests are
  typed methods (`model.load`, `chat.send`, `chat.stop`); token streaming is a
  subscription-style channel emitting `chat.token` events from main to the
  webview. Contract definitions live in `src/shared/` imported by both sides.
- **Rationale**: Electrobun's bridge is the sanctioned transport (constitution
  Principle II) — no WebSocket loopback needed. Token events map naturally to
  its message-passing; request/response maps to model lifecycle and history
  operations.
- **Alternatives considered**:
  - Local WebSocket/HTTP between processes — rejected: extra surface, and the
    bridge already exists.
  - Shared-memory ring buffer for tokens — rejected: over-engineered for text-
    rate throughput (dozens of small messages/sec max).

## Decision 5: Memory management & threading across the FFI boundary

- **Decision**: Pull-based, single-threaded stepping model with an explicit
  ownership protocol:
  - Generation is stepped: `lls_generate_begin` primes, `lls_step` performs
    one decode/sample iteration writing token bytes into a caller-allocated
    buffer, `lls_generate_end` releases generation state. JS drives the loop
    asynchronously, yielding to the event loop between steps so `chat.stop`
    and other RPC stay responsive.
  - **No C worker threads, no `JSCallback`** — empirically verified (Bun
    1.4.4): a `JSCallback` invoked from a pthread-spawned C worker deadlocks
    the process. All FFI calls run on the JS thread.
  - Opaque handle pointers for model/context; JS holds them as `ptr`, never
    dereferences them.
  - Every `lls_*_create/load/begin` has a matching `lls_*_free/end`; the TS
    wrapper exposes `dispose()` plus a `FinalizationRegistry` safety net, but
    deterministic dispose is the contract.
  - Strings: JS→C as null-terminated UTF-8 buffers; C→JS via `char** err`
    out-params freed with `lls_free_string`, or into caller-allocated `buf`
    in `lls_step` (shim writes ≤ `cap` bytes, never retains the pointer).
  - Shutdown order is fixed: `lls_generate_end` → `lls_ctx_free` →
    `lls_model_free` → `lib.close()`.
- **Rationale**: `bun:ffi` does no lifetime tracking; `CString` on a bad/null
  pointer segfaults; and callbacks are confined to the JS thread. A stepped
  pull loop removes the entire class of cross-thread FFI hazards while
  keeping tokens flowing at generation rate.
- **Alternatives considered**:
  - `JSCallback` fired from a C worker — rejected: deadlocks under `bun:ffi`
    (verified with a minimal C spike).
  - Worker thread + lock-free ring buffer drained by `lls_drain()` polling —
    viable fallback if stepping proves too coarse, but adds a queue and
    atomics for no measured benefit.
  - Refcounted C++ wrappers — rejected: complexity without fixing the
    JS-side hazards.
- **Known risk**: `bun:ffi` is documented by Bun as experimental. Mitigation:
  thin boundary, FFI-level integration tests (load → generate → stop →
  free → reload), and no alternative that satisfies the constitution.

## Decision 6: Electrobun bundling strategy

- **Decision**: Two build outputs merged by Electrobun/Hutch:
  1. Renderer built by Vite (`vite build`) to `dist/renderer/` — required
     because shadcn/ui + Tailwind v4 need PostCSS/plugin transforms that
     Hutch's built-in bundler does not run (Hutch config is serialized;
     function-valued plugins unsupported). Output copied via `build.copy`
     into `views/main/` and loaded with `views://main/index.html`.
  2. Main process bundled by Electrobun (`build.bun.entrypoint`); in dev,
     `electrobun dev` serves the Vite dev-server URL for HMR instead of
     `views://`.
  - Native libs staged via `build.copy` into `Resources/app/native/`.
  - Releases: one Electrobun build per OS/arch on its native runner (no
    cross-compilation) producing installer + update artifacts in `artifacts/`.
- **Rationale**: Matches Electrobun's documented pattern for framework
  templates ("run their own Vite build and copy its output") while keeping
  Hutch as the single packager/signing/notarization pipeline.
- **Alternatives considered**: bundling the renderer with Hutch's built-in
  bundler — rejected: can't run the Tailwind v4/shadcn transform pipeline.
