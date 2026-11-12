# Quickstart: UI Modernization — Validation Guide

## Prerequisites

- `bun install` (new radix primitives); dev: `bun run dev`
- Enabled fixtures: `views-pack` (tab view), `notes-pack` (pack item), plus a model that supports fusion for Plan/CoT surfaces
- Gates: `bunx tsc --noEmit && bun test ./tests && bun run lint && bun run build:renderer`

## Scenarios

### S1 — Component audit (SC-001)

1. `bun test ./tests/ui-audit.test.ts` → zero `@radix-ui` imports outside `components/ui/`, zero raw color literals outside `index.css`.

### S2 — AI surfaces (US2)

1. Send a normal message → structured turn layout, actions intact (regenerate/edit/variants).
2. Fusion turn → plan phase renders as collapsible step trace (running→done); answer distinct below.
3. Tool call (`ask` mode) → confirmation prompt inline (approve/deny/session) → executes.
4. Composer → attachments chips, `/`-suggestions as suggestion chips, send/stop.
5. Model selector in header → model menu + fusion tag menus; "Manage" opens library.
6. Variant nav → checkpoint affordances; context chip shows token usage.
7. Enable a pack + run a command → run steps render as task/queue trace; WorkspaceBrowser shows file tree.

### S3 — Themes (US3)

1. OS light mode → app renders light palette; dark → dark. Toggle in settings overrides and survives restart; `system` follows OS live.
2. Extension BrowserView open during toggle → its theme updates live.
3. Reduced-motion on → no non-essential animation; narrow window → all controls reachable.

### S4 — App shell (US4)

1. Sidebar toggle (button + keyboard) → icon rail ↔ full; workspace state preserved.
2. Chats group: search, select, rename, delete, import/export — all work.
3. Extensions group: pack item → focuses its accordion surface; Manage → ExtensionsPanel.
4. Wide window: transcript within readable column, composer anchored; narrow window: sidebar compresses/overlays per component behavior.

## Pass/fail evidence

- `tests/ui-audit.test.ts` green + existing suite unchanged (392+ tests).
- Live S1–S4 in dev window; screenshot light+dark for the PR.
- `git diff` review: no feature file contains `@radix-ui/` imports or raw color values.
