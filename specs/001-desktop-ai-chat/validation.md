# Validation Report — Phase 6

Date: 2025-11-11. Host: linux-x64 (headless). Tasks: T039–T044.

## T039 — FR-011 context-window handling

- `lls_ctx_size` added (10th FFI symbol): C shim -> `ffi.ts` -> `engine.contextSize()`.
- `chat.send` estimates prompt tokens (`ceil(chars/4)`), reserves 512 generation
  tokens, truncates oldest content from the head, emits `chat.warning`
  (`CONTEXT_TRUNCATED`) before generation.
- Covered by `tests/rpc/chat.test.ts`: "over-limit prompt emits chat.warning and
  truncates oldest content" — verifies event emission, messageId match, and
  tail-preserving truncation.
- Strategy documented in `contracts/rpc.md`.

## T040 — Quality gates (all PASS)

| Gate | Command | Result |
|------|---------|--------|
| Typecheck | `tsc --noEmit` | PASS |
| Lint | `oxlint src/bun src/renderer src/shared` | PASS — 0 errors, 4 warnings (non-blocking style) |
| Tests | `bun test ./tests` | PASS — 32/32 across 7 files |
| Renderer build | `vite build` | PASS — 326 kB JS / 14 kB CSS |
| Native build | `scripts/build-native.sh` | PASS — `libllama_shim.so` + libllama/libggml staged |

`.oxlintrc.json` added (correctness=error, suspicious/perf=warn, vendor ignored).

## T043 — Quickstart scenarios

Automated equivalents of `quickstart.md` steps verified:

- Model load/generate/stop/reload lifecycle — `tests/ffi/lifecycle.test.ts` (real
  GGUF inference).
- Corrupt-model recovery — `tests/ffi/errors.test.ts` + `tests/rpc/model.test.ts`.
- Persistence incl. crash recovery (`generating` -> `partial`, torn `.tmp`) —
  `tests/store/json-store.test.ts`.
- RPC contract incl. busy/empty/no-model ordering — `tests/rpc/chat.test.ts`.

Manual `hutch dev` window-launch steps require a display; not executed on this
headless host. Everything below the bridge is covered by the suites above.

## T044 — Canary packaging

`bun run build` (`electrobun build --env=canary`) — PASS.
`build/canary-linux-x64/AIDesktopApp-canary/` (66 MB): launcher, bundled main
process (`Resources/app/bun/index.js`), renderer (`views/main`), all native
artifacts (`native/linux-x64/` incl. `libllama_shim.so`), metadata channel
`canary`. Runtime launch not exercised (headless).

## T041 / T042 — Windows / macOS builds — NOT VERIFIED

`scripts/build-native.ps1` and the `stage-native.ts` platform map cover
win32/darwin paths, but no Windows or macOS host is available here. Must be run
on those hosts before claiming cross-platform support.
