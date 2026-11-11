<!--
Sync Impact Report (temporary — remove before committing)
- Version change: 0.0.0 → 1.0.0 (initial ratification; document was an unfilled template)
- Modified principles: none (all principles newly defined)
- Added sections:
  - Core Principles I–VI (Local-First Inference, Electrobun Process Boundaries,
    Strict TypeScript & Typed FFI, Component Standardization, Vite Build Pipeline,
    Minimal Dependencies)
  - Technology Stack Constraints
  - Development Workflow & Quality Gates
  - Governance
- Removed sections: none
- Follow-up TODOs: none
-->
# AI Desktop App Constitution

## Core Principles

### I. Local-First AI Inference

All LLM inference MUST run locally via llama.cpp, exposed to the application
through Bun FFI bindings. Core product features MUST NOT depend on cloud LLM
APIs, remote inference endpoints, or Node.js native addons (N-API/node-gyp).
Model loading, context management, and token streaming live in a single typed
FFI module; UI code never touches FFI symbols directly.
Rationale: the product's value is private, offline-capable desktop AI; a single
FFI boundary keeps the unsafe surface small and auditable.

### II. Electrobun Process Boundaries

The desktop shell MUST be Electrobun. The Bun-side main process owns native
integration (windowing, FFI, filesystem, model lifecycle); the renderer owns
presentation. All cross-process communication MUST go through typed RPC/IPC
contracts defined in one shared location — no ad-hoc `postMessage` payloads and
no renderer code invoking native functionality outside the contract layer.
Rationale: explicit contracts make the main/renderer split testable and prevent
implicit coupling to the native layer.

### III. Strict TypeScript & Typed FFI

TypeScript strict mode is mandatory in main and renderer code; `any` requires a
justified, localized suppression. Every FFI function signature, every IPC/RPC
message, and every model/context handle MUST have a declared type; data crossing
the FFI boundary MUST be validated before use.
Rationale: FFI failures surface as memory corruption or crashes, not exceptions —
types plus boundary validation are the cheapest line of defense.

### IV. Component Standardization

All UI MUST be composed from shadcn/ui components styled with Tailwind CSS v4
(CSS-first `@theme` configuration — no `tailwind.config.js` unless a documented
need arises). Do not introduce alternative component libraries, CSS-in-JS
runtimes, or utility CSS frameworks.
Rationale: one component system keeps the design coherent and avoids duplicated
styling infrastructure in a desktop bundle.

### V. Vite Build Pipeline

The renderer MUST be built with Vite (React + TypeScript), preserving a working
dev server / HMR workflow. Changes that break `vite build` or HMR are
release-blocking.
Rationale: Vite is the sanctioned fast-iteration path for the frontend; keeping
it healthy protects everyday developer velocity.

### VI. Minimal Dependencies (Simplicity)

Start with the declared stack and nothing more. Prefer Bun, Electrobun, and
browser-standard APIs over new packages; every added dependency MUST be
justified in the change that introduces it (problem solved, why a built-in is
insufficient, maintenance posture). No speculative abstractions or
"future-flexibility" code — YAGNI applies.
Rationale: each dependency is supply-chain and maintenance cost in a desktop
app that must stay lean and auditable.

## Technology Stack Constraints

Non-negotiable stack and substitutions:

- **Shell**: Electrobun only — Electron, Tauri, or NW.js are prohibited.
- **Renderer**: React + TypeScript built by Vite.
- **Styling**: Tailwind CSS v4 (CSS-first config) + shadcn/ui.
- **Native/AI**: llama.cpp via Bun FFI — no N-API, node-gyp, or FFI alternatives
  (e.g., WASM-compiled llama variants) without a constitutional amendment.
- **Runtime**: Bun for the main process and tooling (install, scripts, tests).

## Development Workflow & Quality Gates

- All changes MUST pass `tsc --noEmit` (strict), the project's lint step, and
  `vite build` before merge.
- The FFI boundary (load/unload model, token streaming, error paths) MUST have
  automated tests; renderer behavior tests use the IPC contract, not mocks of
  internal FFI details.
- PR review MUST check: no new dependencies without justification, no IPC
  outside the contract layer, no component-library imports outside shadcn/ui.

## Governance

This constitution supersedes ad-hoc practices and individual preferences.
Amendments require: a documented rationale, approval via PR review by a project
maintainer, and a semantic version bump (MAJOR for principle removal or
backward-incompatible redefinition; MINOR for new principles or materially
expanded sections; PATCH for wording/clarity fixes). Every review of a change
that touches architecture, dependencies, or the FFI/IPC boundary MUST verify
constitution compliance; violations block merge until resolved or the
constitution is formally amended.

**Version**: 1.0.0 | **Ratified**: 2026-11-11 | **Last Amended**: 2026-11-11
