# RPC Contract: Scripts Workspace & External Files

All methods follow the existing handlers.ts convention: `fail("CODE", msg)`
→ `{ error: { code, message } }`. New/changed methods only.

## New methods

### `script.pickImport` → `{ candidates: ScriptImportCandidate[] }`

Opens the native multi-select picker filtered to `.py`/`.r` (case variants).
`null`/cancelled picker → `{ candidates: [] }`. Per-file validation:

- extension ∈ {`.py`, `.r`, `.R`, `.PY`} → else `unsupported-ext`
- must be a regular, readable file → `unreadable`
- must decode as UTF-8 (no NULs/binary) → `invalid-encoding`
- ≤ 2 MiB → `too-large`

Runtime inferred from extension (`.py` → python; `.r`/`.R` → r).
`suggestedId` = slug(basename); `-2`, `-3`… on registry collision.
`duplicateOf` set when the normalized path already backs an entry (linked
or stored). Validation errors arrive in `candidate.error` — the renderer
shows them inline; errored rows are excluded from confirm.

### `script.import(params: ScriptImportParams)` → `{ results: ScriptImportResult[] }`

- `files` empty → `INVALID_PARAMS`
- `files.length > 10` → `INVALID_PARAMS` (batch cap, SC-003)
- per file: revalidates (file may have changed since preview), checks id
  slug + collision → `failed` with reason; `duplicateOf`-known paths →
  `duplicate`
- `mode:"link"` → `source:{kind:"external", path:normalized}`,
  `approvedFingerprint` = sha256(bytes)
- `mode:"copy"` → `source:{kind:"stored"}` + file bytes written to
  `dataDir()/scripts/<id>.<ext>`
- one bad file never aborts the batch (FR-013)

### `script.relink({id})` → `{entry}` | `{entry: null}`

- `SCRIPT_NOT_FOUND` if id absent; `INVALID_PARAMS` if `source.kind !== "external"`
- opens single-file picker (same ext filter); cancel → `{entry: null}`
- extension must match `entry.runtime` → `INVALID_PARAMS`
- success: updates `source.path`, sets `approvedFingerprint` to new bytes.
  Id, params, timeoutMs, enabled preserved (FR-017).

## Changed methods

### `tool.respond` — decision enum gains `"approveChangedSession"`

Only accepted when the pending call carries `contentChanged: true` —
grants the script id for the whole `ns` (conversationId or runId) and
records the new `approvedFingerprint`. On any other call it behaves as
`"approve"` + records the fingerprint if the call is script-backed.

### `script.list` rows

Each `ScriptListItem` gains `linked` and `sourceState` (see data-model.md).

### `script.run` (manual)

Linked + missing source fails with `SCRIPT_SOURCE_MISSING` before any
session work (FR-016). No changed-content prompt for manual runs (FR-019) —
but a successful manual run still refreshes `approvedFingerprint` so the
file the user just ran becomes the baseline.

## Unchanged contract guarantees

`script.upsert` keeps its `source` union — editing a linked script's
`source` via upsert `{kind:"external", path}` resets `approvedFingerprint`
to the new file's bytes (typed-path flow under Advanced).
`script.delete` still refuses nothing extra: linked sources are never
unlinked on delete (only `stored` files are removed, existing behavior).
`runtime.list`/`runtime.detect`/`runtime.reset` unchanged.

## Events

`tool.update` records for script calls may carry `contentChanged: true`
(render the changed-file consent variant). `script.run`/`session.state`
events unchanged.
