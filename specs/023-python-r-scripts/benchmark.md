# Script backend benchmark (FR-023)

Run: 2026-11-13T15:47:47.884Z — `bun scripts/bench-script-backends.ts`

| Backend | Runtime | Metric | Value |
|---|---|---|---|
| subprocess | python | session-startup | 1 ms |
| subprocess | python | cold-call | 37.75 ms |
| subprocess | python | warm-p50 | 0.18 ms |
| subprocess | python | warm-p95 | 0.3 ms |
| subprocess | python | state-fidelity | pass  |
| subprocess | python | 1mib-output | 11ms ok=true  |
| subprocess | python | host-rss | 44 MiB |
| subprocess | r | session-startup | 0 ms |
| subprocess | r | cold-call | 230.79 ms |
| subprocess | r | warm-p50 | 0.8 ms |
| subprocess | r | warm-p95 | 1.24 ms |
| subprocess | r | state-fidelity | pass  |
| subprocess | r | 1mib-output | 144ms ok=true  |
| subprocess | r | host-rss | 47 MiB |
| embedded | python | session-startup | 84 ms |
| embedded | python | cold-call | 0.84 ms |
| embedded | python | warm-p50 | 0.42 ms |
| embedded | python | warm-p95 | 0.52 ms |
| embedded | python | state-fidelity | pass  |
| embedded | python | 1mib-output | 10ms ok=true  |
| embedded | python | host-rss | 82 MiB |
| embedded | r | status | init-fatal — process exited 2 (Fatal error: unable to initialize the JIT)  |
| subprocess | python | crash-containment | host survived, session restarted  |
| subprocess | r | crash-containment | host survived, session restarted  |
| embedded | python | crash-containment | HOST DIED (exit 139) — SIGSEGV  |
| embedded | r | crash-containment | HOST DIED (exit 2)  |
| subprocess | python | packaging | 2 runner files ship in Resources/app; interpreters are user-provided  |
| embedded | python | packaging | needs libpython discovery at runtime + code-signing of dlopen'd libs  |
| embedded | r | packaging | needs script_shim build + libR headers on every target platform  |

## Decision (T043)

**Subprocess is the production backend.** The measurements leave no ambiguity:

- **Warm latency parity**: 0.18–0.8 ms (subprocess) vs 0.42 ms (embedded) — both far under any perceptible threshold; the FFI advantage never materializes because per-call work is JSON round-trips either way.
- **Crash containment (SC-004, decisive)**: subprocess sessions survive `SIGSEGV` inside both runtimes and restart cleanly; embedded kills the host process (exit 139) — a Worker shares the host address space, so in-process interpreter faults are host-fatal. Embedded R cannot even initialize in a worker thread (`init-fatal`, R stack check is main-thread-bound) — consistent with research D3's finding that embedded R is single-global-state and thread-hostile.
- **Memory**: embedded costs ~2× host RSS (82 vs 44–47 MiB) — the interpreter image loads inside the app.
- **Packaging**: subprocess ships two text runner files and uses user-provided interpreters; embedded needs per-platform shim builds, libpython/libR discovery, and dlopen signing surface.

`settings.scripts.backend: "auto"` resolves to `subprocess`. The `embedded`
backend, worker, and `script_shim.c` remain in-tree as the mechanism-(a)
prototype per FR-024 — contract-identical, selectable for development.
