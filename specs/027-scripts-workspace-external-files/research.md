# Research: Scripts Workspace & External Script Files

## R1 — Linked source is the existing `external` kind

**Decision**: `ScriptSource = {kind:"stored"} | {kind:"external", path}` already
models linked scripts. Import "Link" writes `external`; "Copy" writes `stored`
via `ScriptStore.writeSource`. `ScriptStore.readSource` already re-reads the
file at each open/run (FR-011, FR-021 grandfathering for free).

**Rationale**: no data-model migration — only an optional fingerprint field is
added.
**Alternatives**: a third `kind:"linked"` (rejected: duplicates `external`).

## R2 — Content-change detection via stored fingerprint

**Decision**: `ScriptEntry` gains optional `approvedFingerprint?: string`
(SHA-256 of the source bytes the user last approved). Recorded at import/link,
at relink, and whenever a consent prompt for changed content is approved.
Absent (pre-027 entries) ⇒ first model/pipeline run of a linked script prompts
once, then records.

**Rationale**: one cheap hash at consent time; no file watching (spec
assumption: "the app does not watch files continuously").
**Alternatives**: mtime+size (rejected: not tamper-evident enough); signing
(rejected: no key material exists).

## R3 — Where the re-consent gate lives

**Decision**: `ScriptService.consentState(entry, ns)` returns
`"auto" | "ask" | "ask-changed" | "source-missing"`. Both invocation sites
(`tools/loop.ts` `runScriptVerdict`, `fabric/runtime.ts`) call it instead of
`autoApprove`. `source-missing` short-circuits with a distinct refusal
(FR-016); `ask-changed` forces a prompt even when `autoApprove` is true
(FR-018). A new grant map `changedGrants: Map<ns, Set<scriptId>>` backs
"Approve changes to this script for this session".

`ScriptDecision` gains `"approveChangedSession"`; `tool.respond` already
fans out to `scripts().respond`, so the decision rides the existing channel.
Approving a changed-content prompt persists the new `approvedFingerprint`.

**Rationale**: one choke point; both initiators get identical semantics.
**Alternatives**: duplicating the check at each call site (rejected: drift).

## R4 — Import is a two-call RPC flow

**Decision**: `script.pickImport` (opens the existing `dialogs.pickFiles`
multi-select, extension filter `py,PY,r,R`) → returns per-file candidates
`{path, fileName, runtime, suggestedId, duplicateOf?, error?}` after
server-side validation (readable, UTF-8 text, ≤ 2 MiB — the established
text-file bound from feature 009 attachments; no stored-source cap existed).
Then `script.import {files: [{path, id}], mode: "link"|"copy"}` → per-file
`{status: "imported"|"duplicate"|"failed", id?, reason?}`. Partial failure
never aborts the batch (FR-013); a re-picked already-linked path reports
`duplicateOf` (FR-014). Id dedup: `-2`, `-3`… suffix on slug collision.

**Rationale**: FR-009 needs editable suggested ids *before* confirming —
that forces a preview round-trip.
**Alternatives**: single-call import with auto ids (rejected: FR-009).

## R5 — Sidebar Scripts area = grouped NavGroup + per-script selection

**Decision**: `AppSidebar` gains a top-level "Scripts" `NavGroup` (Chats /
Extensions / Scripts / Configurations). Inside it, one collapsible sub-group
per language that has scripts: `Python (n)` / `R (n)`, alphabetical, runtime-
missing badge when `runtimeStatus === "missing"` (data already on
`ScriptListItem`), disabled entries dimmed. New/Import/Runtime-settings
actions at the group footer.

The `surface:scripts` workspace surface stays but renders `ScriptDetail`
(run form + code + params + in-place edit) for a `selectedScriptId` kept in
ChatPage workspace state — no per-script `WorkspaceTab` kind needed.
Breadcrumb uses the existing `features/workspace/breadcrumb.ts`:
`Scripts › Python › <id>`.

**Rationale**: mirrors how 026 renders surfaces (mounted-hidden siblings);
one selection id avoids a growing tab/surface union.
**Alternatives**: per-script `WorkspaceTab` entries (rejected: surfaces are
singletons; hundreds of scripts = unbounded tab set).

## R6 — Command palette integration

**Decision**: script entries join the palette as a "Scripts" group fed from
`script.list` (open detail) plus an action "Import script from file" and
"New script". No new RPC.

**Rationale**: FR-007 "each script can be opened by name"; the 026 palette
already accepts dynamic lists (conversations/models precedent).
**Alternatives**: fuzzy search server-side (rejected: overkill, titles
filter client-side like conversations).

## R7 — "Source missing" presentation

**Decision**: `ScriptListItem` gains `sourceState: "ok" | "missing"` computed
in `ScriptService.list()` (external + `readSource` null ⇒ missing). The
sidebar badge, the detail header, and the refusal in R3 all read the same
field — no second stat call per row.

**Rationale**: one stat per list call; consistent UI/refusal (FR-016, SC-005).
**Alternatives**: lazy check on open (rejected: sidebar wouldn't show the
state, violating FR-016 "when it is listed").

## R8 — Relink

**Decision**: `script.relink {id}` → `dialogs.pickFile("py,PY,r,R")` →
validate (same rules as import, extension must match the script's runtime)
→ update `source.path`, refresh `approvedFingerprint` to the new bytes
(user-picked file = approval baseline), keep id/params/timeout/enabled.
Renaming the id never touches the link (FR-017, edge case).

## R9 — Audit trail

**Decision**: `recordAudit` call in `ScriptService.call` gains
`origin: "linked" | "stored"` from `entry.source.kind` (FR-022). No other
audit changes.
