# Data Model: Script Host Interface (feature 028)

Entities crossing the Bun↔host boundary and the service↔backend boundary.
Field names are wire names (snake_case on the wire, camelCase in `shared/types.ts`).

## RunRequest (Bun → host, one NDJSON line)

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | ✓ | correlates response; `runId` |
| `protocol` | number | ✓ | wire protocol version = 1 |
| `op` | `"run"` | ✓ | only request op in v1 (cancel is a signal, not a line) |
| `path` | string | ✓ | absolute script file path — module reads it itself (FR-001) |
| `args` | object | ✓ | declared params → runtime variables |
| `input` | string | — | raw text for paramless scripts |
| `cwd` | string | ✓ | per-run working dir (files produced land here) |
| `expected_sha256` | string | — | when set and file bytes differ → `content_changed` (FR-005) |
| `limits` | object | — | `{cpu_s?, mem_bytes?, output_bytes?}` — host-side rlimits/caps (FR-012) |

## RunResult (host → Bun, one NDJSON line)

| Field | Type | Notes |
|---|---|---|
| `id` | string | echoes request |
| `outcome` | enum | `ok` · `error` · `interrupted` · `timeout` · `source_missing` · `content_changed` · `host_fault` (FR-014) |
| `value` | string | script's returned value, rendered as text |
| `error` | object | `{type, message, traceback, file, line}` — `file`/`line` where the language provides them (FR-003) |
| `stdout` / `stderr` | string | both in-language AND fd-level writes captured (FR-015); truncated+marked over `output_bytes` |
| `files` | string[] | names produced inside `cwd` |
| `content_sha256` | string | hash of the exact bytes executed (FR-004) |
| `duration_ms` | number | host-measured |

## ReadyLine (host → Bun, first line after spawn)

`{"protocol":1, "abi":<int>, "language":"python"|"r", "ready":true}` — Bun MUST
reject mismatched `protocol`/`abi` (FR-009) and treat a missing/garbled ready
line as host-start failure → fallback (FR-019).

## Service↔backend contract change

`ScriptCallRequest` (src/bun/scripts/backend.ts) changes from `code: string` to:

```ts
{ runId, path, args, input?, cwd, timeoutMs,
  expectedFingerprint?, limits?: {memBytes?, outputBytes?} }
```

`ScriptCallResult` gains `outcome`, `contentSha256`, `error?`, `method`,
`methodReason?`. `ScriptBackend.kind` becomes `"subprocess" | "host"`
(`"embedded"` removed with the prototype, FR-023).

## LanguageModule (build/runtime availability)

`{language, abiVersion, availability: "usable"|"missing"|"unsupported-interp"|"version-mismatch"}` —
resolved at `ensure()` time; `"usable"` requires module .so + interpreter +
shared lib (Python ≥3.14) + ABI match.

## RunMethod (audit extension)

`AuditEntry` gains `method: "host" | "subprocess"` and `methodReason?: string`
(e.g. `"python-3.11"`, `"no-libpython"`, `"host-not-built"`) — recorded once per
run; a one-time user notice when fallback engages (FR-019/020).

## HostSession (Bun-side, per language)

`{kind, process, state: "starting"|"ready"|"running"|"dead", pendingId?}` —
one serialized host per language (two runs queue, as today, FR edge case);
`host_fault` / dead pipe → `state:"dead"` + respawn on next call (SC-002);
`PR_SET_PDEATHSIG` (Linux) + `dispose()` guarantee no orphans (FR-013).
