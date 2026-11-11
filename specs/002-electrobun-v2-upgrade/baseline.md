# Baseline: pre-Electrobun-v2 state

Recorded 2026-11-11 before `electrobun@^2` bump (regression reference for SC-002).

- `bun run typecheck` — PASS (0 errors, strict tsc)
- `bun run lint` — PASS (0 findings, oxlint on `src/bun src/renderer src/shared`)
- `bun run build:renderer` — PASS (`dist/renderer` emitted: index.html + assets,
  ~70 kB gzip JS)
- `bun test ./tests` — PASS (0 test files yet; suite starts in feature-001 T018+)
- `electrobun` version: 1.18.1

Note: `bun test` unscoped picked up vendored llama.cpp test files — test script
fixed to `bun test ./tests` (literal dir scan; `tests/` substring-matched
vendor paths).
