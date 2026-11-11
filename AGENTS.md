# AGENTS.md

Electrobun 2.x + Bun desktop AI chat app (local llama.cpp via `bun:ffi`).

## Commands

| Task | Command |
|------|---------|
| Dev (window + HMR) | `bun run dev` — `hutch dev` → vite :5173 + `electrobun dev --watch` |
| Canary package | `bun run build` — `hutch run build` → `electrobun build --env=canary` → `build/canary-<platform>/` |
| Stable package | `bun run build:stable` |
| Native libs | `bun run build:native` → `native/out/<platform>/` |
| Typecheck | `bun run typecheck` (tsc strict) |
| Lint | `bun run lint` (oxlint) |
| Test | `bun test ./tests` — MUST be scoped; unscoped `bun test` picks up vendored llama.cpp tests |
| Renderer build | `bun run build:renderer` (vite → `dist/renderer`) |

Notes:

- Use `hutch run <script>` for scripts in `hutch.config.ts` — bare `hutch
  build` is a Hutch built-in that forwards to `bun build`, not the scripts map.
- Package manager is Bun (`bun install`, `bun.lock`); `hutch install` uses a
  different resolver — avoid.
- TypeScript resolves `electrobun/*` via `.hutch/devkit` (projected by
  `bun x electrobun prepare`; regenerate after toolchain bumps).
- `.hutch/dependencies.lock` is committed; `.hutch/devkit/`, `.hutch/locks/`,
  `build/`, `native/out/`, `models/` are ignored.

## Architecture (one-liner)

`src/bun` (main process: window, typed RPC handlers, llama FFI engine, JSON
store) ↔ `src/shared` (RPC contract + domain types) ↔ `src/renderer` (React +
Tailwind v4 + shadcn via Vite) ; `src/native/shim` = pull-based C ABI over
vendored llama.cpp. Feature docs under `specs/`.
