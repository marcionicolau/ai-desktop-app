# Implementation Plan: Multi-Agent Workspace & Extension Plugins

**Branch**: `017-multi-agent-plugin-ui` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/017-multi-agent-plugin-ui/spec.md`

## Summary

Turn the app into a host for **declarative extension packs** (spec-agents-style
domain packs) and add a **multi-agent workspace** to browse and run what they
contribute. A pack is a directory/archive with a `pack.yaml` manifest, `SKILL.md`
components/pipelines, `AGENT.md` agent trees, and optional static UI views.
The host embeds a TypeScript fabric runtime (`src/bun/fabric/`) that validates
contracts, executes pipeline DAGs and agent trees (router/sequential
supervisors over structured LLM output) through the existing `EngineLike`
llama.cpp engine — packs ship **no code**. Extension UI views render in
isolated Electrobun `BrowserView` surfaces anchored into the main window,
each with a dedicated narrow RPC bridge (`ext.*` methods only) and its own
partition. Install sources: local folder/archive (`.tgz`) and remote
URL/registry JSON (no marketplace). Zero new runtime dependencies.

## Technical Context

**Language/Version**: TypeScript strict (Bun 1.4.x main process, React 19/Vite renderer)

**Primary Dependencies**: Electrobun `BrowserView` + `defineElectrobunRPC` (isolated views + narrow RPC), `Bun.YAML` (manifest + frontmatter), `DecompressionStream` + hand-rolled tar reader (`.tgz` packs), existing `EngineLike`/`createRegistryEngine` — **zero new dependencies**

**Storage**: `dataDir()/extensions/<slug>/` (pack files), `dataDir()/extensions.json` (lifecycle state), `dataDir()/runs/<packId>/<runId>.json` (run history, capped), `dataDir()/pack-data/<packId>/` (per-pack scoped storage)

**Testing**: `bun test` — `tests/fabric/` (contracts, DAG, agent runner, tar), `tests/extensions/` (install/enable/isolation), `tests/rpc/` handler tests

**Target Platform**: Electrobun desktop (Linux dev target; cross-platform code paths)

**Project Type**: desktop-app (Bun main + webview renderer over typed RPC)

**Performance Goals**: enable/disable without restart <500 ms; run start → first progress event <2 s warm; pack scan of 10 packs <1 s

**Constraints**: packs are declarative — no pack code executes in host or views beyond declared static assets; extension views get only the `ext.*` bridge; model access only via host `EngineLike`; tar/gzip implemented in-repo (no dep)

**Scale/Scope**: ~15 new files across `src/bun/fabric/`, `src/bun/extensions/`, `src/shared`, `src/renderer/src/features/{extensions,fabric}` + extension-view preload/bridge; ~6 touched files (handlers, contract, types, ChatPage/Sidebar)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Local-First AI | PASS | fabric runtime drives the existing local llama.cpp `EngineLike`; remote pack fetch is distribution, not inference (FR-018) |
| II. Electrobun Boundaries | PASS | all extension I/O in main via typed RPC; extension views get a separate typed schema (`ext.*`) — never the host RPC surface |
| III. Strict TS & Typed FFI | PASS | contracts validated structurally; zero FFI changes |
| IV. shadcn/Tailwind v4 | PASS | host UI only; extension views are external bundles that receive theme tokens via the bridge — host components unchanged |
| V. Vite pipeline | PASS | renderer additions only; extension views bypass Vite (static assets via `viewsRoot`) |
| VI. Minimal deps | PASS | `Bun.YAML`, `DecompressionStream`, hand tar reader; spec-agents patterns ported, not imported |

No violations → Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/017-multi-agent-plugin-ui/
├── plan.md              # this file
├── research.md          # Phase 0 — D1–D10 decisions
├── data-model.md        # Phase 1 — PackManifest, InstalledPack, RunRecord, …
├── quickstart.md        # Phase 1 — validation scenarios
├── contracts/
│   ├── pack-format.md   # manifest schema + SKILL/AGENT frontmatter subset
│   ├── rpc.md           # host RPC: extension.*, pack.*, run.* + events
│   └── view-bridge.md   # ext.* bridge available inside extension views
└── tasks.md             # Phase 2 (/speckit-tasks — NOT this command)
```

### Source Code (repository root)

```text
src/
├── shared/
│   ├── types.ts            # + PackView, RunSummary, Contribution descriptors
│   ├── rpc-contract.ts     # + extension.*/pack.*/run.* methods & events
│   └── pack-schema.ts      # NEW manifest/frontmatter TS types + API_LEVEL
├── bun/
│   ├── fabric/
│   │   ├── frontmatter.ts  # Bun.YAML parse + structural contract validation
│   │   ├── registry.ts     # skill/pipeline/agent registration, <pack>:<name> ns
│   │   ├── components.ts   # built-in deterministic components + runtime:prompt
│   │   ├── pipeline.ts     # DAG executor (topo order, port binding)
│   │   ├── agent.ts        # agent-tree runner: router/sequential supervisors
│   │   ├── runtime.ts      # run orchestration: budget, trace, abort, persist
│   │   └── errors.ts       # located PackError/FabricError types
│   ├── extensions/
│   │   ├── store.ts        # scan/install/enable/disable/remove + state json
│   │   ├── fetch.ts        # remote URL/registry fetch, .tgz extract (tar reader)
│   │   ├── bridge.ts       # ext.* RPC schema factory per view (capability-gated)
│   │   └── views.ts        # BrowserView lifecycle: create/anchor/destroy/theme
│   └── rpc/handlers.ts     # + extension.*, pack.*, run.* handlers & events
└── renderer/src/
    ├── features/extensions/   # ExtensionsPanel (list/install/consent/errors)
    ├── features/fabric/       # WorkspaceBrowser, RunView, TraceView
    └── lib/ext-view-host.ts   # embeds/positions BrowserView slots (via RPC)
```

**Structure Decision**: three-layer split matching the codebase convention —
`src/shared` contract types, `src/bun` all execution/IO, `src/renderer`
presentation. Extension views are pack-shipped static assets, not part of
this tree (they live under `dataDir()/extensions/<slug>/views/`).

## Complexity Tracking

> No constitution violations — empty.
