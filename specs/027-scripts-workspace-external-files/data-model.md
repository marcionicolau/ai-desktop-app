# Data Model: Scripts Workspace & External Script Files

Changes to `src/shared/types.ts` and `src/bun/scripts/`.

## ScriptEntry (persisted, `scripts.json`)

```ts
export interface ScriptEntry {
  id: string;
  runtime: ScriptRuntimeKind;          // "python" | "r"
  source: ScriptSource;                // UNCHANGED union
  description: string;
  params: ScriptParam[];
  timeoutMs?: number;
  enabled: boolean;
  approvedFingerprint?: string;        // NEW — sha256 of last-approved source
                                       // bytes (linked scripts only)
}
```

- `approvedFingerprint` is recorded at link-import, at relink, and when a
  changed-content consent prompt is approved. Copy-import entries get none
  (stored sources can't drift).
- Absent on a linked entry ⇒ next model/pipeline run prompts once
  (treated as "never approved").

## ScriptSource (unchanged)

```ts
export type ScriptSource =
  | { kind: "stored" }                          // dataDir()/scripts/<id>.<ext>
  | { kind: "external"; path: string };         // LINKED — absolute path
```

"Linked" = `external`. "Copied" = `stored`. Old entries with `external`
continue to work (FR-021).

## ScriptListItem (`script.list` response row)

```ts
export interface ScriptListItem extends ScriptEntry {
  runtimeStatus: "ready" | "missing";
  sourceState: "ok" | "missing";        // NEW — external+unreadable ⇒ missing
  linked: boolean;                      // NEW — source.kind === "external"
}
```

`sourceState` is computed in `ScriptService.list()` via one `existsSync`
per external entry (R7). `linked` drives the "external" badge.

## New RPC payloads

### `script.pickImport` → `ScriptImportCandidates`

```ts
export interface ScriptImportCandidate {
  path: string;                        // normalized absolute path
  fileName: string;
  runtime: ScriptRuntimeKind;
  suggestedId: string;                 // slug of basename, deduped (-2, -3…)
  duplicateOf?: string;                // id of an existing entry on same path
  error?: { code: ScriptImportError; reason: string };
}
export type ScriptImportError =
  | "unsupported-ext" | "unreadable" | "invalid-encoding" | "too-large";
```

### `script.import` → per-file results

```ts
export interface ScriptImportParams {
  mode: "link" | "copy";               // link = default
  files: { path: string; id: string }[];
}
export interface ScriptImportResult {
  path: string;
  status: "imported" | "duplicate" | "failed";
  id?: string;                         // script id when imported/duplicate
  reason?: string;
}
```

### `script.relink` `{id}` → `{entry}` (or `{entry: null}` when picker cancelled)

Same file validation as import + extension must match `entry.runtime`.
On success: `source.path` updated, `approvedFingerprint` = sha256(new bytes).

## Consent state (internal)

```ts
// ScriptService additions
consentState(entry, ns): "auto" | "ask" | "ask-changed" | "source-missing"
// "ask-changed" ⇒ force prompt even under autoApprove/session grant
// "source-missing" ⇒ refusal before any prompt
changedGrants: Map<ns, Set<scriptId>>  // "approve changed for session"
// cleared with existing session grants (resetScriptGrants)
```

`ScriptDecision` gains `"approveChangedSession"` — only meaningful on a
changed-content prompt; elsewhere treated as `approve` + fingerprint record.

`ToolCallRecord` (already has `call.script`) gains `contentChanged?: boolean`
so the renderer renders the changed-file prompt variant.

## Audit record

`dataDir()/script-runs/<runId>/audit.json` gains:

```json
{ "origin": "linked" | "stored", "sourcePath": "<abs path or null>" }
```

## Invariants

- Slug `^[a-z0-9]+(?:-[a-z0-9]+)*$` — unchanged; import suggestions reuse it.
- Every external entry has an absolute normalized path (tilde `~` expanded,
  `realpath`d; relative/unsafe paths rejected).
- Max file size at import/relink: 2 MiB (attachments bound, R4).
- Registry remains atomic temp+rename (`scripts.json`).
- Copy-import bytes land at `dataDir()/scripts/<id>.<ext>` — same file
  stored scripts already use.
