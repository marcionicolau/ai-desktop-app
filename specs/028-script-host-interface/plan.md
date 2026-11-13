# Implementation Plan: Script Host Interface

**Branch**: `028-script-host-interface` | **Date**: 2026-11-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/028-script-host-interface/spec.md`

## Summary

Replace the text-passing script execution path with scripts run **as files from
their own path** inside dedicated per-language **C host processes** (`cz-host`)
that embed each interpreter through one versioned, language-neutral C ABI
(`cz_script.h` + `libcz_python` / `libcz_r`). The Bun side talks to hosts over a
newline-delimited JSON wire protocol — same shape as today's subprocess backend —
behind a new `ScriptBackend` kind `"host"`; the existing subprocess backend stays
as the automatic fallback (Python <3.14, no `libpython.so`, host not built).
First release is Linux-only; the in-process Worker prototype and `script_shim.c`
are removed once the host is the default. Research (`research.md`) already
measured this design end-to-end with `experiments/` prototypes: crash-contained,
<1 ms interrupts, warm p50 below today's subprocess figures.

## Technical Context

**Language/Version**: TypeScript strict (Bun 1.4) for the backend; C11 for the
host and modules; Python ≥3.14 (host path only — `PyInitConfig` API); R ≥4.x.

**Primary Dependencies**: none added — host is `dlopen`-based C; Python module is
header-free (`dlopen(libpython*.so)` + name-based `PyInitConfig`); R module links
`libR` where R headers exist. Renderer/UI untouched.

**Storage**: N/A — `scripts.json` registry and `tool-audit.jsonl` unchanged
(audit gains a `method` field per FR-020).

**Testing**: `bun test ./tests` (scoped) + a shared conformance suite driven by
Bun against each `cz-host` binary; benchmark script comparing against feature
023 figures.

**Target Platform**: Linux x86_64 desktop (Electrobun/WebKitGTK) — verified.
macOS/Windows keep the subprocess backend until hosts are verified there.

**Project Type**: desktop app (Electrobun) with a new native component.

**Performance Goals** (from SC-002..004): interrupt ≤100 ms of cancel; respawn ≤1 s
(Python) / ≤2 s (R); warm p50 ≤ 0.18 ms Python / ≤0.8 ms R; startup ≤38 ms
Python / ≤231 ms R (first call included). Measured prototypes already beat all
of these.

**Constraints**: scripts MUST run outside the app process; no Python dev files
may be required to build `libcz_python`; R module optional at build time;
`jsonlite` MUST NOT be required for R; no new runtime dependencies; consent /
policy / per-run folders / audit semantics of features 023+027 unchanged —
`svc.call` keeps handing a **path + expected fingerprint** down, the backend
layer decides host-vs-fallback.

**Scale/Scope**: one C ABI header, one ~300-line neutral host, two ~300–500-line
language modules, one new Bun backend file, conformance suite + benchmark;
removal of `script_shim.c`, `embedded.ts`, `embedded-worker.ts`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict |
|---|---|
| I. Local-first AI via FFI | PASS — no inference changes; the FFI boundary (llama shim) is untouched. The host is a *process* boundary, not a second in-app FFI surface. |
| II. Electrobun process boundaries | PASS — host lives entirely in the Bun main process behind `ScriptBackend`; no renderer or RPC-shape changes beyond audit's `method` field. |
| III. Strict TS & typed FFI | PASS — ABI is a versioned C header; the wire protocol is fully typed in `shared/types.ts`; all host-boundary JSON is validated (size caps, outcome enum). |
| IV. Component standardization | PASS — no UI work beyond an optional method badge already allowed by audit. |
| V. Vite pipeline | PASS — renderer untouched. |
| VI. Minimal dependencies | PASS — zero new packages; replaces an existing prototype. One small C runtime artifact set is justified as the only containment-capable embedding path (rejected alternatives in research §4). |

No violations — no Complexity Tracking entries needed.

## Project Structure

### Documentation (this feature)

```text
specs/028-script-host-interface/
├── plan.md              # This file
├── research.md          # Phase 0 — exists: audit + 5 experiments + decision
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── abi.md           # cz_script.h — versioned C ABI contract
│   └── protocol.md      # Bun ↔ cz-host NDJSON wire protocol
├── experiments/         # throw-away hosts proving the numbers (kept)
├── checklists/
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
src/native/
└── script-host/
    ├── cz_script.h            # the ABI every module implements (contract)
    ├── cz-host.c              # neutral host: dlopen(module), NDJSON loop,
    │                          #   rlimits, pdeathsig, signal escalation, fd capture
    ├── CMakeLists.txt         # cz-host + libcz_python always; libcz_r when R found
    └── modules/
        ├── python.c           # header-free dlopen(libpython) + PyInitConfig + bootstrap
        └── r.c                # libR on host main thread; JSON in C; srcref locations

src/bun/scripts/
└── backends/
    ├── host.ts                # NEW: ScriptBackend "host" — spawn cz-host, wire protocol,
    │                          #   respawn on host_fault, fallback signalling
    ├── subprocess.ts          # kept — fallback (FR-019)
    ├── embedded.ts            # REMOVED (FR-023)
    └── embedded-worker.ts     # REMOVED (FR-023)

src/native/shim/
└── script_shim.c              # REMOVED (FR-023) once host is default

src/shared/types.ts            # ScriptResult + outcome enum extended;
                               # AuditEntry.method: "host" | "subprocess" (+ reason)
src/bun/scripts/service.ts     # call() → backend contract unchanged (path +
                               # expectedFingerprint); audit method recording

tests/
├── scripts/
│   ├── host-backend.test.ts   # host.ts unit tests (fake cz-host over pipes)
│   └── host-fallback.test.ts  # auto-fallback reasons + one-time notice
└── conformance/               # language-neutral suite run per host binary
    ├── suite.ts               # the SC-009 behaviour battery
    └── bench.ts               # startup / first-call / warm p50-p95 (FR-022)

scripts/stage-native.ts        # stage cz-host + libcz_* beside llama shim
```

**Structure Decision**: native C lives beside `src/native/shim` as
`src/native/script-host/` with its own CMake target (the llama tree is
untouched); the Bun backend slot is the existing `ScriptBackend` contract so
`service.ts`, consent, and audit need no shape changes.

## Phase 0 — research

`research.md` predates this plan and already satisfies Phase 0: code audit
(§1 D1–D9), five experiments with measured numbers (§3), options matrix (§4),
recommended architecture (§5), findings→fix map (§6), risks (§7), delivery
order (§8). No unresolved NEEDS CLARIFICATION remains — the two spec-level
markers were resolved in the 2026-11-13 clarify session (host-per-language
process; Linux-only first release).

## Phase 1 — design artifacts

- `data-model.md` — wire + service entities (RunRequest, RunResult/Outcome,
  HostSession, LanguageModule availability, RunMethod).
- `contracts/abi.md` — the `cz_script.h` C ABI (versioning, run_file, cancel,
  result accessors, limits).
- `contracts/protocol.md` — the Bun↔host NDJSON protocol (handshake, request,
  response, cancel, limits, protocol version).
- `quickstart.md` — build + conformance + benchmark walkthrough.

## Constitution re-check (post-Phase-1)

All gates still PASS — design adds no dependency, no new FFI surface in the
app process, no renderer work.
