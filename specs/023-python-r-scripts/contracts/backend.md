# Contract: ScriptBackend — mechanism-interchangeable execution

Both candidate mechanisms implement this interface (FR-022/FR-024);
`SessionManager` is the only consumer, so the winner drops in without
touching callers. Types live in `src/bun/scripts/backend.ts`.

## Interface

```ts
interface ScriptBackend {
  kind: "subprocess" | "embedded";
  // cold → live: start/attach the runtime session (idempotent)
  ensure(rt: RuntimeId): Promise<void>;
  // serialized by SessionManager before reaching here:
  // run code in the live session; args + workdir prepared by caller
  call(rt: RuntimeId, req: {
    runId: string;
    code: string;            // script source
    args: Record<string, unknown>;
    cwd: string;             // script-runs/<runId>/
    timeoutMs: number;
  }): Promise<{
    exitStatus: number | null;
    stdout: string;          // raw — caller caps
    stderr: string;
    durationMs: number;
    files: string[];         // names produced inside cwd
    sessionRestarted: boolean;
  }>;
  // terminate the session (reset); ensure() may start it again
  reset(rt: RuntimeId): Promise<void>;
  status(rt: RuntimeId): { state: SessionState; restartCount: number };
  dispose(): Promise<void>;   // app shutdown — all sessions
}
```

## Behavioral requirements either impl must satisfy

- State in `args` order, captured output, produced-file listing, and
  session persistence across calls are identical observable behavior.
- Timeout enforcement is the backend's duty (host-side timer for
  subprocess; worker-terminate for embedded) — caller sees
  `verdict: "timeout"`.
- A dead session is reported via `sessionRestarted` after re-`ensure`;
  the backend MUST NOT silently create fresh state mid-call.
- Env/cwd confinement (D9) applies to subprocess natively; embedded
  honors `cwd` by `chdir`-equivalent injection into the session and
  cannot scrub env — documented asymmetry the benchmark records.

## Benchmark gate (FR-023) — `scripts/bench-script-backends.ts`

Workload matrix per available runtime, both backends:

| Workload | Measures |
|---|---|
| cold start | session `ensure` latency |
| warm trivial call ×50 | p50/p95 round-trip latency |
| state-accumulating seq | cross-call state fidelity (pass/fail) |
| ~1 MiB output | throughput + cap behavior |
| RSS snapshot | host + child/worker memory |
| forced fault | crash containment: does the host process survive? |
| artifact/packaging check | per-platform distribution feasibility |

Records to `specs/023-python-r-scripts/benchmark.md` (markdown table +
raw JSON). Selection rule: crash containment is a hard gate — a
mechanism that takes the host down on a script fault loses regardless
of latency. Among survivors, latency/memory/fidelity decide; ties
favor the simpler mechanism (subprocess).
