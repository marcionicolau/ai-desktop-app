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

## Commit convention

Spec Kit hooks only fire at command boundaries (no per-task hook event).
Convention: commit after each completed task or small task group during
implementation via
`.specify/extensions/git/scripts/bash/auto-commit.sh <phase> --message-file <f>`
with a conventional-commit message.

## Module map (feature 003)

Main process (`src/bun/`):

- `llama/prompt.ts` — pure ChatML/plain prompt assembly + token-budgeted
  history truncation (`buildPrompt`, injectable `costOf`).
- `llama/params.ts` — `GenerationParams` merge/validate + `packParams` into
  the 32-byte `lls_gen_params` FFI struct.
- `llama/ffi.ts` — `dlopen` symbol surface incl. `lls_generate_continue`,
  `lls_token_count`, `lls_gguf_meta` (FFI ptr returns `null`, not `0`).
- `models/library.ts` — `models/` scan + `readGgufMeta` (header-only GGUF
  parse via shim); `MODELS_DIR` env override for tests.
- `rpc/handlers.ts` — all RPC incl. `chat.regenerate`/`chat.edit` (shared
  `streamAssistant` driver), `model.list`/`model.download`/`model.setOverride`.
- `store/json-store.ts` — `Settings.generation` + `modelOverrides`,
  `deleteMessagesAfter` primitive.

Native (`src/native/shim/`): `lls_gen_params` sampler chain (greedy when
`temperature<=0`), KV token mirror + longest-common-prefix reuse
(`lls_generate_continue`, `2` = full-decode fallback), `lls_gguf_meta`.

Renderer (`src/renderer/src/`): `components/ai/` (markdown `AiMessage`,
`CodeBlock` copy, `MessageActions`), `features/settings/GenerationSettings`,
`features/models/ModelLibrary` (download form + per-model overrides).

Gotchas:

- ChatML literals in `prompt.ts` are deliberately split (`"<" + "|im_...|>"`)
  because the edit toolchain strips the literal tokens — do not merge them.
- `chat.send` accepts `userMessageId` so optimistic renderer ids match the
  store; required for `chat.edit` to find fresh user messages.
