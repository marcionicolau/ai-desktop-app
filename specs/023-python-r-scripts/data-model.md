# Data Model: Python & R Script Calling

Entities follow existing conventions: registry persisted as JSON in
`dataDir()`, sources as sibling files, run records transient + audit
JSONL. All types land in `src/shared/types.ts` (renderer consumes the
same shapes over RPC).

## Script (registry entry, persisted)

| Field | Type | Notes |
|---|---|---|
| `id` | string (slug) | unique, kebab-case — the name the model calls |
| `runtime` | `"python" \| "r"` | which session executes it |
| `source` | `{ kind: "stored" }` or `{ kind: "external", path }` | stored → `dataDir()/scripts/<id>.<ext>`; external → absolute path, degrades to source-unavailable |
| `description` | string | shown in library + injected into prompts |
| `params` | `ScriptParam[]` | declared inputs; `[]` → single raw text arg |
| `timeoutMs?` | number | per-script override within `MAX_SCRIPT_TIMEOUT` |
| `enabled` | boolean | disabled → refused `unknown-script` for calls |

## ScriptParam

| Field | Type | Notes |
|---|---|---|
| `name` | string | arg key in `run_script` calls + pipeline port |
| `type` | `"text" \| "number" \| "json" \| "bool"` | validated before execution (FR-006) |
| `required` | boolean | missing required → refused pre-execution |
| `description` | string | injected into the prompt's script section |

## ScriptRuntime (per-language config, settings)

| Field | Type | Notes |
|---|---|---|
| `kind` | `"python" \| "r"` | one entry per language |
| `path` | string | interpreter executable — user-set wins over detection |
| `detected` | string \| null | last auto-detected path (informational) |
| `status` | `"ready" \| "missing"` | missing → library badge + calls fail `runtime-unavailable` |

## Session (transient, per runtime)

| Field | Type | Notes |
|---|---|---|
| `runtime` | `"python" \| "r"` | one session each, app-wide |
| `state` | `"cold" \| "starting" \| "live" \| "dead"` | lazy start on first call |
| `startedAt` | timestamp | uptime display + staleness |
| `calls` | number | diagnostics; grows until reset |
| `restartCount` | number | crash/reset history (FR-020 surfacing) |

State transitions: `cold → starting → live`; on fault `live → dead`,
next call `dead → starting` with `sessionRestarted` flagged on the run.
Reset is `live → cold → starting` (explicit).

## ScriptRun (per call, timeline card + audit)

| Field | Type | Notes |
|---|---|---|
| `runId` | string | also names `dataDir()/script-runs/<runId>/` workdir |
| `script` | string | registry id |
| `args` | Record | validated call arguments (summary in audit) |
| `initiator` | `"model" \| "user" \| "pipeline"` | who asked |
| `verdict` | `"executed" \| "error" \| "timeout" \| "denied" \| "refused"` | refused carries reason |
| `exitStatus` | number \| null | interpreter-level exit |
| `stdout`/`stderr` | string | capped capture (truncated + marker) |
| `durationMs` | number | measured |
| `files` | string[] | produced files in workdir (attachable) |
| `sessionRestarted` | boolean | true → prior session state was lost |

## ToolCallRecord (extension — feature 015 record)

Adds optional fields; existing records untouched:
`tool: "run_script"` • `script?: string` • `args?: Record` •
`exitStatus?: number` • `durationMs?: number` • `files?: string[]`.
`path` field carries the script id for legacy display.

## Settings delta

```ts
settings.scripts?: {
  mode: "ask" | "allow-session" | "deny";       // default "deny" — opt-in like tools
  runtimes: { python?: { path?: string }; r?: { path?: string } };
  backend?: "auto" | "subprocess" | "embedded"; // default "auto" → benchmark winner
}
```

Activation rule: script calls are offerable iff `mode !== "deny"` AND
at least one runtime is `ready`. Session grants are per-conversation (or
per-run), in-memory only — same semantics as ToolService.grants.

## Audit extension

`tool-audit.jsonl` lines gain `script`, `initiator`, `exitStatus`,
`durationMs`, `sessionRestarted` when `tool === "run_script"` —
appended on every executed/errored/timed-out call (FR-013).
