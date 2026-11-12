# Quickstart: Extension UI Tabs — Validation Guide

## Prerequisites

- `bun install`; dev run: `bun run dev` (vite :5173 + Electrobun window)
- Fixture packs: `tests/extensions/fixtures/views-pack`, `notes-pack`, `crash-view-pack` — seedable via folder copy into `<dataDir>/extensions/` or the UI install flows
- Headless gates first: `bunx tsc --noEmit && bun test ./tests && bun run lint && bun run build:renderer`

## Scenarios

### S1 — Baseline: no packs (FR-001/002)

1. `bun run dev` with no enabled packs.
2. Expect: tab bar shows only **Chat**, selected; no close control.

### S2 — Enable → tab appears focused (FR-003/004/005)

1. Install + enable `views-pack`.
2. Expect: a **Results Explorer** tab appears right of Chat within ~1 s and is auto-selected; its content renders.
3. Hover the tab → tooltip shows `Results Explorer — views-pack` (FR-009).

### S3 — Switching preserves state (FR-007, SC-003)

1. In the Results Explorer tab, mutate state (fixture uses `ext.storage` / counters).
2. Switch to Chat, type a draft; switch back.
3. Expect: explorer state intact (no reload); chat draft intact.

### S4 — Live lifecycle (FR-005/010, SC-005)

1. With the extension tab selected, disable `views-pack` in the Extensions panel.
2. Expect: its tab closes immediately; selection falls back to Chat.
3. Re-enable → tab returns and auto-selects.

### S5 — Restart restore (FR-006)

1. Quit with `views-pack` enabled.
2. Relaunch → tab bar shows Chat + Results Explorer; **Chat** stays selected (no focus steal).

### S6 — Single session / Browse→Open focus (FR-013)

1. With the extension tab open, go to Extensions → `views-pack` → Browse → click Open on the `tab` view.
2. Expect: the existing top tab is selected — no second host, no new session.

### S7 — Crash containment (FR-008)

1. Enable `crash-view-pack`; select its tab.
2. Expect: contained crash message + **Reload view** inside the tab; Chat and other tabs unaffected.

### S8 — Panels unchanged (FR-012)

1. `notes-pack` (no views) contributes no tab.
2. `panel`-slot views still open via Browse → Open in the drawer.

### S9 — Overflow (FR-011)

1. Install several tab-view packs (or duplicate fixtures under different pack names).
2. Expect: tab strip scrolls horizontally; titles truncate; all tabs reachable.

## Pass/fail evidence

- Headless: new `tests/workspace-tabs.test.ts` covers derive/reconcile transitions incl. auto-select, fallback-to-chat, restart-restore, duplicate-focus; `views-visible.test.ts` covers park/restore.
- Live: checklist above covers S1–S9; view logs via `bun run dev` console (`view.error`, `view.setVisible` traffic).
