# UI Contract: Scripts Workspace

Builds on feature 026's Midnight design system — every primitive comes from
`src/renderer/src/components/ui/` + tokens; no new components needed.

## Sidebar (AppSidebar)

Top-level `NavGroup` order: **Chats · Extensions · Scripts · Configurations**.
The `Scripts` item currently under Configurations moves here; the old
entry is removed.

Inside the Scripts group (FR-002):

- `New script` action (opens empty ScriptDetail in create mode) and
  `Import from file…` action (opens import flow) — icon-only buttons in the
  group label row, tooltipped.
- One collapsible sub-group per language **that has entries**:
  `Python (n)` / `R (n)` — count in the label, entries sorted
  case-insensitively by id (FR-003).
- Sub-group label carries a `runtime missing` badge (AlertCircle, warning
  token) when every… when the language's `runtimeStatus === "missing"`
  (FR-004). Individual rows keep a small `disabled` (dimmed + `·disabled`
  suffix) and `linked` (Link icon suffix) affordance.
- Row click selects `surface:scripts` + sets `selectedScriptId` —
  two clicks max from anywhere (SC-001).
- Footer row: `Runtime paths…` link → `surface:settings` (script section
  anchor) (FR-012).

## ScriptDetail (replaces ScriptsPage as `surface:scripts` body)

States: empty (no script → New/Import CTAs), create, view/edit one script.

- Header: id (title-truncated), language badge, `external` badge + path
  (title attr, truncated middle) for linked, `source missing` warning
  badge when `sourceState === "missing"` with a `Relink…` button (FR-016).
- Body: `RunForm` (existing), params table, code pane (FR-023: **read-only
  for linked scripts**, showing the file's current content), `ScriptEditor`
  metadata fields (id, params, enabled, timeout — editable in place). The
  Advanced section keeps the editable absolute-path field for linked
  scripts (FR-020); code changes happen on disk or via Copy import.
- Breadcrumb (existing `features/workspace/breadcrumb.ts`):
  `Scripts › Python|R › <id>`; `Scripts` alone when nothing selected.

## Consent prompt (ToolCallCard variant)

When `call.contentChanged === true` the card renders the changed-file
variant (FR-018):

- warning icon + "Script changed on disk since you last approved it"
- buttons: `Approve once` · `Approve changes to this script for this
  session` · `Deny`
- decisions map to `approve` / `approveChangedSession` / `deny` via the
  existing `tool.respond`.

## Import flow (script.pickImport → dialog → script.import)

Dialog (existing `ui/dialog`): file list with per-row language badge,
suggested-id input (pre-filled, editable — FR-009), error rows shown
reason + excluded; footer = mode toggle `Link (default) | Copy` (FR-008)
and per-file `status` after confirm (imported/duplicate/failed, FR-013/014).

## Palette

`features/command/CommandPalette` gains a `Scripts` group: each script
→ navigate to its detail; actions `Import script from file` and
`New script` (FR-007/SC-001). Filter client-side like conversations.
