# Validation: Extension UI Tabs

**Gates**: `tsc --noEmit` clean · `bun test ./tests` **391 pass / 0 fail** · `bun run lint` 0 errors · `bun run build:renderer` ✓

## Headless coverage

| Scenario | Covered by | Status |
|---|---|---|
| S1 chat-only baseline | `deriveTabs` tests (chat first, no packs → chat only) | ✅ headless |
| S2 enable → tab + auto-select | `reconcile` "newly enabled tab auto-selects" | ✅ headless logic; ⚠️ live visual pending |
| S3 switch preserves state | parking semantics in `views-visible.test.ts` (park bounds, show no-op) + keep-mounted render | ⚠️ live visual pending |
| S4 disable/remove → close + fallback | `reconcile` vanished-selection + removal tests | ✅ headless logic |
| S5 restart restore, chat stays selected | baseline-derive + known-tab test (FR-006) | ✅ headless logic |
| S6 Browse→Open focuses tab | `onOpenTabView` routing in ChatPage (slot==="tab" → focusView) | ⚠️ live pending |
| S7 crash contained in tab | existing `markCrashed`/`view.error` + `onCrash` badge wiring | ⚠️ live pending |
| S8 panels unchanged | `deriveTabs` excludes `slot:"panel"` | ✅ headless |
| S9 overflow scroll | `overflow-x-auto` + `shrink-0`/`max-w-44` truncate | ⚠️ live pending |

## Live E2E pending

Visual/interactive checks remain for the dev window (same caveat as 017/018): S2 auto-select, S3 park/restore visual, S6 focus routing, S7 crash badge, S9 overflow. The `--watch` rebuild picks this branch's changes automatically — enable `views-pack` and check the tab bar.

## Notes

- `view.setVisible` is bounds-parking (`x:-10000`), not a real visibility API — parked webviews still run (research R1, accepted for v1).
- `ExtViewHost` in tab mode is `bare` (no header/close) — closing happens via pack disable/remove per A5.
- Sessions open lazily on first tab selection (A8) — a restored tab costs zero webviews until clicked.
