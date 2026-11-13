# Contract: RPC — script.* / runtime.*

New methods join the shared `rpc-contract.ts` map; all execute in the
main process. `tool.respond` is reused unchanged for script-call
decisions (FR-005). `surfaceId` gains `"scripts"`.

## script.list → ScriptListItem[]

One item per registry entry: `{ id, runtime, description, params,
enabled, sourceKind, runtimeStatus }` — `runtimeStatus` mirrors the
entry's runtime (`"ready" | "missing"`) for library badges.

## script.upsert (params → entry)

```ts
params: {
  id?: string;              // absent → create (slug from name)
  name: string;             // → slug; must stay unique
  runtime: "python" | "r";
  description?: string;
  source: { kind: "stored"; text: string } | { kind: "external"; path: string };
  params?: ScriptParam[];
  timeoutMs?: number;       // ≤ MAX_SCRIPT_TIMEOUT
  enabled?: boolean;        // default true
}
response: { entry: ScriptListItem }
```

Validation errors: `INVALID_PARAMS` (slug clash, bad param type,
timeout over cap, source unreadable). Stored source is written to
`dataDir()/scripts/<slug>.<ext>`.

## script.delete `{ id }` → `{}`

Removes entry + stored source file. In-flight calls for it finish
(holding a source snapshot); future calls get `unknown-script`.

## script.run `{ id, args?, timeoutMs? }` → ScriptRunResult

Manual run (initiator `"user"`). Executes under the same
validation/timeout/workdir rules as model calls but **bypasses the
consent prompt** — the user clicked Run. Emits `script.run` progress
events for the UI. Response: `{ runId, verdict, exitStatus, stdout,
stderr, durationMs, files, sessionRestarted }` (captures capped;
`files` are workdir-relative names attachable via the existing
attachment path).

## script.enable `{ id, enabled }` → `{}`  *(may fold into upsert)*

## runtime.list → RuntimeStatus[]

`[{ kind: "python" | "r", configuredPath, detectedPath, status,
session: { state, calls, restartCount } | null }]` — feeds the
settings/runtime section.

## runtime.detect `{ kind }` → `{ path }`

Re-runs detection for one runtime; error `RUNTIME_NOT_FOUND` when
nothing resolves.

## runtime.reset `{ kind }` → `{}`

Kills and clears the runtime's session (FR-018). Next call restarts
cold. In-flight call → terminated, reported `verdict: "interrupted"`.

## Reused methods

- `tool.respond` — resolves pending script calls identically (decision
  applies to the call's consent namespace: conversation or run).
- `tool.update` — emitted for run_script calls with the extended
  `ToolCallRecord` (script, args summary, status, duration, files).
- `settings.set` — carries `scripts` policy/runtime/backend changes.
- `attachment` pipeline — produced files attach by run-dir path.

## Error codes added

`SCRIPT_NOT_FOUND` • `SCRIPT_DISABLED` (folds into unknown for model
calls — the model must not probe the registry) • `RUNTIME_NOT_FOUND` •
`SCRIPT_INVALID_ARGS` • `SCRIPT_TIMEOUT` • `SESSION_DEAD` •
`CAPABILITY_DENIED` (existing; packs without `scripts.run`).

## Events added

- `script.run` `{ runId, script, phase: "queued"|"running"|"done"|"error", progress? }` — powers the manual-run view and queued state.
- `session.state` `{ runtime, state, restartCount }` — powers the runtime health row.
