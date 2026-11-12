# AI Desktop App

[![ci](https://github.com/marcionicolau/ai-desktop-app/actions/workflows/ci.yml/badge.svg)](https://github.com/marcionicolau/ai-desktop-app/actions/workflows/ci.yml)
[![packaging](https://github.com/marcionicolau/ai-desktop-app/actions/workflows/packaging.yml/badge.svg)](https://github.com/marcionicolau/ai-desktop-app/actions/workflows/packaging.yml)
[![Bun](https://img.shields.io/badge/runtime-Bun-black?logo=bun&logoColor=white)](https://bun.sh)
[![Electrobun](https://img.shields.io/badge/shell-Electrobun%202.x-8A2BE2)](https://electrobun.dev)
[![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![llama.cpp](https://img.shields.io/badge/inference-llama.cpp%20in--process-success)](https://github.com/ggml-org/llama.cpp)
[![spec-driven](https://img.shields.io/badge/process-spec--driven%20(Spec%20Kit)-blue)](https://github.com/github/spec-kit)

Local-first AI chat desktop app — an [Electrobun](https://electrobun.dev) 2.x +
[Bun](https://bun.sh) shell with llama.cpp inference running in-process via
`bun:ffi`. No cloud calls: models are local GGUF files, conversations and
settings are local JSON.

<!-- screenshots -->

## Features

- **Local inference** — vendored llama.cpp behind a pull-based C ABI shim
  (`src/native/shim`), streamed tokens over typed Electrobun RPC.
- **Model library** — scans `models/` for GGUF files, parses headers
  in-process, per-model generation overrides, downloads, and a
  benchmark-based advisor (fit verdicts, recommended ctx) before loading.
- **Roles & fusion mode** — bind tags to models with ordered fallback chains
  (max 3); a two-phase plan→answer turn can split planner and executor across
  different models.
- **Conversation branching** — regenerate/edit creates sibling variants, not
  destructive resets; variant picker and branch overview in the UI.
- **Personas & prompt presets** — system prompts and `/`-picker snippets,
  cascaded `DEFAULT < global < persona < modelOverride < tag`.
- **Attachments** — pick local files into a turn; budgeted, line-truncated
  injection with per-file status.
- **Sandboxed tool use** — models can emit `read_file`/`list_dir` calls
  confined to a configured root, with ask/allow/deny policy.
- **Search, export & backup** — instant title+content search with hit
  highlighting; versioned JSON envelopes (conversations, settings, tags) and
  Markdown rendering.
- **KV-state persistence** — snapshot/restore KV cache per conversation so
  follow-ups skip re-prefill across restarts.
- **Output stats panel** — per-call token/latency metrics grouped by model,
  role and persona.
- **Auto-update** — packaged builds check a channel-scoped release feed on
  launch, download verified (`tarSha256`) bundles in the background, and
  apply on explicit restart; stable/canary channel selection, silent
  offline degradation, fully disableable (`AI_DESKTOP_APP_UPDATE=off`).
  The feed is the app's only update-network surface — see `docs/updates.md`.

## Requirements

- [Bun](https://bun.sh) (project toolchain is pinned by Hutch)
- [Hutch](https://github.com/blackrabbit/hutch) CLI on PATH
- cmake + a C++ toolchain (gcc/clang on Linux/macOS, MSVC on Windows)
- A GGUF model in `models/` — or download one from the in-app model library

## Development

| Task | Command |
|------|---------|
| Dev (window + HMR) | `bun run dev` |
| Typecheck | `bun run typecheck` |
| Lint | `bun run lint` |
| Test | `bun test ./tests` (scoped — never bare `bun test`) |
| Native libs | `bun run build:native` |
| Renderer build | `bun run build:renderer` |
| Full canary package | `bun run package` |
| Full stable package | `bun run package:stable` |

CI: `.github/workflows/ci.yml` runs typecheck/lint/tests on `main` and PRs.

## Releases

The git tag is the source of truth — pushing a `v*` tag runs
`.github/workflows/packaging.yml`, which builds per-platform artifacts and
publishes a GitHub Release:

- `bun run release:stag` — tag `vX.Y.Z-rc.N` → canary-channel build, marked
  prerelease.
- `bun run release:prod` — promote the validated rc to `vX.Y.Z` (must be at
  the rc's commit) → stable-channel build.
- `bun run release:status` — latest stable tag, open rc train, HEAD.

`SKIP_TESTS=1` and `ASSUME_YES=1` adjust the release script's gates.

## Configuration

| Variable | Purpose |
|----------|---------|
| `MODELS_DIR` | override the GGUF scan directory (default `<userData>/models`) |
| `APP_DATA_DIR` | override the app-data root (store, snapshots, attachments) |
| `RELEASE_CHANNEL` | `canary` (default) or `stable` — version suffix + update channel |
| `VITE_DEV_URL` | dev-mode renderer URL (set by `bun run dev`) |

## Project layout

```
src/bun/        main process — window, RPC handlers, llama FFI engine, stores
src/shared/     RPC contract + domain types shared with the renderer
src/renderer/   React 19 + Tailwind v4 + shadcn UI (Vite)
src/native/     C ABI shim over vendored llama.cpp (cmake)
scripts/        native build, packaging verify, version, release.ts
specs/          Spec Kit feature specs and implementation artifacts
tests/          bun:test suites (FFI suites self-skip without a model)
```

## Spec-driven development

Features are built with [GitHub Spec Kit](https://github.com/github/spec-kit):
every change starts as a reviewed spec, not as code. Artifacts live in
`specs/<NNN>-<short-name>/` on a matching `<NNN>-<short-name>` branch:

| Artifact | Contents |
|----------|----------|
| `spec.md` | stakeholder-facing requirements (user stories, FRs, edge cases) |
| `plan.md` | architecture decisions against the project constitution |
| `tasks.md` | dependency-ordered, testable task breakdown |
| `data-model.md`, `research.md`, `contracts/`, `checklists/` | supporting design docs |

The flow per feature: `speckit-specify` → `speckit-clarify` → `speckit-plan`
→ `speckit-tasks` → `speckit-analyze` → `speckit-implement` →
`speckit-converge`. The project constitution
(`.specify/memory/constitution.md`) gates every plan; conventional commits
land per task via the git auto-commit extension
(`.specify/extensions/git/`).

See `specs/` for shipped features (roles & fusion, conversation branching,
attachments, personas, KV snapshots, sandboxed tools, packaging, …) and
`AGENTS.md` for the module map they produced.

## Contributing

Issues and PRs welcome. Keep `bun run typecheck`, `bun run lint` and
`bun test ./tests` green; feature work follows the Spec Kit flow above.

## License

TBD.
