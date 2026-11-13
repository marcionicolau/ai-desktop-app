# Quickstart: Scripts Workspace & External Script Files

Feature branch: `027-scripts-workspace-external-files`

## Run it

```bash
bun install
bun run dev            # vite :5173 + electrobun window
```

## Exercise the feature (manual)

1. **Sidebar** — the sidebar shows a Scripts group next to Chats and
   Extensions, split into `Python (n)` / `R (n)` collapsible sub-groups.
2. **Create** — `New script` opens ScriptDetail directly (run form + code
   + params). Save → the script appears in its language group.
3. **Import** — `Import from file…` → pick several `.py`/`.r` files →
   preview dialog shows per-file language + editable id + errors → toggle
   Link/Copy → confirm. Rows report imported/duplicate/failed.
4. **Linked lifecycle** — open a linked script: `external` badge + path.
   Move the file away → sidebar/detail show `source missing` + Relink.
   Relink picks a new file; id/params preserved.
5. **Changed-content consent** — approve a `run_script` tool call (or
   allow-session), then edit the linked file on disk → next model/pipeline
   run of that script prompts "changed on disk" with
   `Approve changes to this script for this session`. Manual Run never
   prompts extra.
6. **Palette** — Ctrl/Cmd+K → type a script name → Enter opens its detail.
7. **Runtime paths** — Scripts group footer → Runtime paths → Settings.

## Test

```bash
bun test ./tests                           # full suite (scoped!)
bun run typecheck && bun run lint
bun run build:renderer
```

Focused files: `tests/rpc/scripts.test.ts` (import/relink/consent),
`tests/scripts/*` (store/service), `tests/renderer/` (grouping,
consent-variant rendering).

## Key paths

- `src/bun/scripts/store.ts` — registry + source files
- `src/bun/scripts/service.ts` — consentState, changedGrants, audit origin
- `src/bun/rpc/handlers.ts` — `script.pickImport/import/relink`
- `src/bun/tools/loop.ts`, `src/bun/fabric/runtime.ts` — consent call sites
- `src/renderer/src/features/chat/AppSidebar.tsx` — Scripts NavGroup
- `src/renderer/src/features/scripts/` — ScriptDetail, import dialog
- `src/shared/types.ts` — fingerprints, sourceState, new payloads
