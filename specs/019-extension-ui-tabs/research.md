# Research: Extension UI Tabs

## D1 — Where the tab bar lives

**Decision**: New `WorkspaceTabs` root component mounted by `main.tsx`; `ChatPage` becomes the content of the fixed first tab.

**Rationale**: `ChatPage` is currently the React root with no App wrapper — a tab bar must sit *above* it, not inside it. Wrapping keeps `ChatPage` untouched (it keeps owning chat state, the extensions drawer, `ExtViewHost` for panel views).

**Alternatives**: tab bar inside ChatPage — rejected; extension tabs would render inside chat layout chrome (header/composer), breaking peer status.

## D2 — Preserving extension view state across tab switches

**Decision**: Keep `ExtViewHost` mounted for hidden tabs; park the native `BrowserView` offscreen via a new `view.setVisible(sessionId, visible)` RPC → `ViewManager` calls `setBounds` with a parked rect (`{x:-10000,y:-10000,w:1,h:1}`) when hiding and re-pushes real bounds when showing.

**Rationale**: Electrobun's `BrowserView` has **no** `setVisible`/`hide` — only `frame`/`remove` (verified in `.hutch/devkit/api/sdks/main/core/BrowserView.ts`). `view.close` on unmount destroys state (violates FR-007). Offscreen parking keeps the webview process alive and running — true state preservation.

**Alternatives**: (a) close + reopen on re-select — loses view state, violates FR-007. (b) renderer calls `view.setBounds` with the parked rect directly — works today with zero new RPC, but buries platform semantics in the renderer; `view.setVisible` is one small handler and self-documenting. Chosen for contract clarity; setBounds remains the underlying mechanism.

## D3 — Tab model source of truth

**Decision**: Derive tabs purely in the renderer from `extension.scan` (enabled packs) + `pack.contributions`/`manifest.contributions.views` (`slot === "tab"`), refreshed on `extension.changed` events. Selection is session-only React state.

**Rationale**: Enablement already persists via `extensions.json` and scan re-registers at startup (FR-006 restore is free). No new persistence = no migration, no drift between tab state and pack state.

**Alternatives**: persisting tab order/selection — A4 rules out reordering; restart selection is Chat per clarification Q1.

## D4 — Single session per `tab` view

**Decision**: `ViewManager.open` already enforces one session per pack+view (reopen replaces). Renderer honors FR-013: Browse → Open for a `tab`-slot view selects its top tab instead of invoking `view.open` again.

**Rationale**: duplicate `BrowserView`s for the same view would double native views and split `view.error`/crash routing; clarification Q2 confirmed single-session.

## D5 — Enable → auto-select, restart → don't

**Decision**: When `extension.changed` carries a pack transitioning to `enabled`, its first `tab` view's tab is selected. Restored tabs on startup never steal selection (Chat/previous stays selected).

**Rationale**: clarified (session 2026-11-12 Q1); matches the shipped auto-open UX (`ExtensionsPanel.afterEnable`, commit 894b9fb) which this feature supersedes — `afterEnable` will switch to selecting the tab instead of opening a drawer host.

## D6 — Tab overflow & empty title

**Decision**: Tab strip is a horizontally scrollable flex row (`overflow-x-auto`, `shrink-0` tabs); titles truncate with ellipsis and tooltip shows `<view title> — <pack name>`; empty title falls back to `viewId` then `packId`.

**Rationale**: satisfies FR-004/FR-009/FR-011 with plain CSS, no measured-width JS.

## Risks / open items

- **R1 — parked views still run**: offscreen webviews keep consuming CPU if the pack's page animates. Acceptable for v1 (spec-consistent "state preserved"); revisit with a suspend API if Electrobun adds one.
- **R2 — bounds races on rapid tab switches**: ResizeObserver re-push on selection is idempotent; park/show are last-write-wins over the same `setBounds` channel — no interleaving issue.
- **R3 — ExtViewHost `visible` prop**: hosts in the drawer (panel views) must keep default `visible=true` semantics so current behavior is unchanged.
