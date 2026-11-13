# Implementation Plan: Python & R Script Calling

**Branch**: `023-python-r-scripts` | **Date**: 2026-11-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/023-python-r-scripts/spec.md`

## Summary

A persisted script library (name, runtime, source, declared params,
timeout) becomes callable three ways: by the model mid-turn via an
extended ````tool_call` grammar (`run_script`), manually from a library
page, and from extension-pack pipeline steps (`runtime: "script"`).
Every path flows through one `ScriptService` → `SessionManager` →
`ScriptBackend` chain, so consent, validation, timeouts, serialization,
and audit are identical everywhere. Each runtime (python, r) holds a
persistent interpreter session — state survives calls, same-runtime
calls serialize, user reset restarts it. Per FR-022/023 the production
`ScriptBackend` is chosen by measured benchmark between two prototypes:
(a) FFI-embedded interpreter in a dedicated Bun Worker, (b) supervised
`Bun.spawn` child process running a session runner (NDJSON stdio).
Known asymmetry recorded in research D3: embedded R cannot be
re-initialized in-process, so reset/crash-restart may force a
per-runtime mechanism split — the benchmark documents it, not assumes.

## Technical Context

**Language/Version**: TypeScript strict (Bun 1.4.x main, React/Vite renderer); user-supplied Python 3.x + R ≥ 4; C11 shim for the embedded prototype only

**Primary Dependencies**: Electrobun typed RPC, `Bun.spawn` + NDJSON stdio (mechanism b), `bun:ffi` + `dlopen`'d libpython/libR inside a `Worker` (mechanism a), node:fs — **zero new npm dependencies**

**Storage**: `dataDir()/scripts.json` registry + `dataDir()/scripts/<slug>.<ext>` sources; `settings.json` (`scripts` policy + runtime paths); `dataDir()/script-runs/<id>/` per-run workdirs; existing `tool-audit.jsonl` (extended record)

**Testing**: `bun test` — `tests/scripts/` suites (store, service, session, both backends, policy), `tests/tools/` run_script cases, `tests/fabric/` script-skill cases; benchmark harness `scripts/bench-script-backends.ts`

**Target Platform**: Electrobun desktop (Linux dev target; subprocess path is inherently cross-platform, embedded path is platform-sensitive — measured)

**Project Type**: desktop-app (Bun main + webview renderer over typed RPC)

**Performance Goals**: warm script-call round-trip ≪ one token of model output; benchmark decides winner on measured latency/memory/crash-containment rather than targets

**Constraints**: sessions serialize per runtime; script/FFI crash must never take down the app (measured per mechanism); `deny` mode leaves prompts byte-identical; outputs capped + budgeted like tool results; sessions app-wide, user-resettable

**Scale/Scope**: ~20 new files (scripts/ module ×7, runners ×2, embedded worker, C shim prototype, renderer feature ×4, bench harness), ~10 touched files (tool-call parser, loop, prompt, handlers, fabric frontmatter/components/registry, pack-schema, types, contract)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Local-First AI | PASS w/ condition | all execution is local; **mechanism (a) adds a second FFI surface** (libpython/libR) beyond llama.cpp — benchmark-gated; if it wins it needs explicit justification or a constitution note at merge time |
| II. Electrobun Boundaries | PASS | execution only in main (or its Worker/child process); renderer reaches everything via typed RPC — new methods added to the single shared contract |
| III. Strict TS & Typed FFI | PASS | session calls validate args against declared params before touching the backend; FFI signatures fully typed if (a) selected |
| IV. shadcn/Tailwind v4 | PASS | library page + script call cards compose existing primitives |
| V. Vite pipeline | PASS | renderer additions only |
| VI. Minimal deps | PASS | zero npm deps; interpreters are user-provided; C shim source is vendored in-repo (like `llama_shim.c`) and only ships if benchmark selects (a) |

Conditional note on I carried to Complexity Tracking — not a hard
violation yet because the mechanism is benchmark-gated and the default
may never ship the embedded path.

## Project Structure

### Documentation (this feature)

```text
specs/023-python-r-scripts/
├── plan.md              # this file
├── research.md          # Phase 0 — D1–D12 decisions
├── data-model.md        # Phase 1 — Script/Param/Runtime/Session/ScriptRun
├── quickstart.md        # Phase 1 — validation scenarios incl. benchmark
├── contracts/
│   ├── rpc.md           # script.* + runtime.* methods, tool.respond reuse
│   ├── tool-call.md     # run_script grammar + prompt injection
│   ├── pack-script.md   # runtime:"script" skill + scripts.run capability
│   └── backend.md       # ScriptBackend contract + benchmark gate
└── tasks.md             # Phase 2 (/speckit-tasks — NOT this command)
```

### Source Code (repository root)

```text
src/
├── shared/
│   ├── types.ts           # + ScriptEntry, ScriptParam, ScriptRuntime, SessionState,
│   │                      ScriptRunRecord, ScriptPolicy; ToolCallRecord+script/args;
│   │                      Settings.scripts; ToolName + "run_script"
│   ├── rpc-contract.ts    # + script.list/upsert/delete/run, runtime.list/reset,
│   │                      script.respond reuse; surfaceId + "scripts"
│   ├── tool-call.ts       # parseCallBody: run_script branch (script+args)
│   └── pack-schema.ts     # + CAPABILITIES "scripts.run"
├── bun/
│   ├── scripts/
│   │   ├── store.ts       # scripts.json registry + sources dir CRUD
│   │   ├── service.ts     # CRUD, policy/grants, validation, audit hookup
│   │   ├── session.ts     # lazy start, per-runtime serialization queue,
│   │                      # timeout kill, crash→restart flag, reset
│   │   ├── backend.ts     # ScriptBackend interface (both mechanisms satisfy)
│   │   ├── backends/
│   │   │   ├── subprocess.ts # Bun.spawn runner, NDJSON stdio protocol
│   │   │   └── embedded.ts   # Worker + FFI session (mechanism a)
│   │   ├── runners/
│   │   │   ├── python_runner.py # session runner: exec into shared namespace
│   │   │   └── r_runner.R       # session runner: eval into persistent env
│   │   └── embedded-worker.ts   # Worker owning the FFI session (mechanism a)
│   ├── native/shim/
│   │   └── script_shim.c  # prototype: libR embed + output capture (benchmark a)
│   ├── tools/
│   │   ├── loop.ts        # verdict pipeline + run_script branch (script→resolve→approve→backend)
│   │   └── service.ts     # + scripts policy/grants (or delegate to ScriptService)
│   ├── llama/prompt.ts    # + script tool instruction when policy allows
│   ├── fabric/
│   │   ├── frontmatter.ts # runtime:"script" validation
│   │   ├── components.ts  # runSkill → script skill branch
│   │   └── registry.ts    # scripts.run capability registration
│   └── rpc/handlers.ts    # script.*, runtime.*, wire run_script into tool loop
└── renderer/src/
    ├── features/scripts/
    │   ├── ScriptsPage.tsx    # library list + runtime health row
    │   ├── ScriptEditor.tsx   # name/runtime/source/params form
    │   ├── RunForm.tsx        # manual run: params form + captured result
    │   └── use-scripts.ts     # RPC hooks
    ├── features/tools/
    │   └── ToolCallCard.tsx   # + run_script variant (script, args, status, output)
    └── features/settings/
        └── ScriptsSettings.tsx # policy mode, interpreter paths, backend select, session reset
scripts/
└── bench-script-backends.ts   # FR-022/023 benchmark harness
tests/
└── scripts/                   # store, service, session, backends, policy suites
```

**Structure Decision**: single-project layout unchanged. Script execution
lives in `src/bun/scripts/` (main-process boundary), mirroring how
`src/bun/tools/` owns filesystem tools. The bench harness is a repo
script (not shipped in the bundle); the C shim prototype lives beside
`llama_shim.c` and only ships if mechanism (a) wins.

## Post-Design Constitution Re-check

- I: still conditional — both prototypes are built, but the production
  merge only carries the embedded path if it demonstrably beats
  subprocess and the FFI-surface expansion is justified at that point.
  If subprocess wins, zero new FFI surface ships.
- II–VI: unchanged PASS — all new IPC is in the shared contract,
  validation happens before any backend call, no new dependencies, and
  `deny` mode keeps prompts byte-identical by construction (script
  instruction injection gated on policy upstream of prompt assembly).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Second FFI surface (libpython/libR) — only if benchmark selects mechanism (a) | measured latency/state fidelity wins over subprocess | subprocess session is the default; (a) ships only with measured superiority AND must still satisfy crash-containment findings — an embedded fault kills the host, which may rule (a) out regardless of speed |
