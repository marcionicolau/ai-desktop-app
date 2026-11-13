# Tasks: Extension UI Tabs

**Input**: Design documents from `/specs/019-extension-ui-tabs/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/tabs.md, quickstart.md

**Organization**: US1 = extension views as peer tabs (P1) · US2 = live lifecycle sync (P1) · US3 = tab identity & crash (P2)

## Phase 1: Setup

- [x] T001 Create `src/renderer/src/features/workspace/` directory for the new module

---

## Phase 2: Foundational (Blocking Prerequisites)

Shared types, contract, and the park/restore primitive every story depends on.

- [x] T002 [P] Add `WorkspaceTab` union + `view.setVisible` request payload types in `src/shared/types.ts` (chat kind `id:"chat"`, ext kind `id:"${packId}:${viewId}"`, `title`, `packName`)
- [x] T003 Add `"view.setVisible"` request to `src/shared/rpc-contract.ts` — `{ sessionId, visible } → {}`
- [x] T004 [P] Add `setVisible(sessionId, visible)` to `ViewManager` in `src/bun/extensions/views.ts` — parks via `setBounds({x:-10000,y:-10000,width:1,height:1})` when hidden; visible=true is a bounds no-op (host re-pushes); idempotent; unknown session → `NOT_FOUND` PackError
- [x] T005 Wire `"view.setVisible"` handler in `src/bun/rpc/handlers.ts` → `viewMgr().setVisible`
- [x] T006 [P] Implement pure helpers `deriveTabs(packs)` and `reconcile(tabs, selectedId, changed)` in `src/renderer/src/features/workspace/use-workspace-tabs.ts` — derivation rules and transition table per `data-model.md` (auto-select on enable, fallback to `"chat"` on close, restore keeps `"chat"`)
- [x] T007 [P] Write `tests/extensions/views-visible.test.ts` — park sets offscreen bounds, re-show is a no-op, unknown session → `NOT_FOUND`, double-hide idempotent (inject fake `ViewFactory`)

---

## Phase 3: US1 — Extension views become peer tabs of Chat (P1)

**Goal**: enabled pack's `tab` views render as titled peer tabs; switching preserves state.

**Independent test**: enable `views-pack` → "Results Explorer" tab appears → click through tabs → extension UI + chat state intact (quickstart S2/S3).

- [x] T008 [US1] Write `tests/workspace-tabs.test.ts` — `deriveTabs` (chat first, enabled-only, per-declared-`tab`-view, title fallback `title ?? viewId ?? packId`, scan→declaration order) + `reconcile` transitions per `data-model.md`
- [x] T009 [P] [US1] Create `TabBar.tsx` in `src/renderer/src/features/workspace/` — horizontal scrollable strip (`overflow-x-auto`, `shrink-0`), Chat tab fixed first with no close control, ext tabs titled, tooltip `<title> — <packName>`, click selects, `aria-selected`/`data-testid="workspace-tab"`
- [x] T010 [US1] Add `visible` (default `true`) and `bare` (default `false`) props to `ExtViewHost` in `src/renderer/src/features/extensions/ExtViewHost.tsx` — hidden → `view.setVisible(false)` + skip bounds pushes; visible → `view.setVisible(true)` + resume ResizeObserver pushes; **lazy-open**: defer `view.open` until the first `visible=true` (A8 — no eager webviews at boot); `bare` hides the `packId:viewId` header + Close button for tab-mode hosting (crash state + Reload stay inline)
- [x] T011 [US1] Create `WorkspaceTabs.tsx` in `src/renderer/src/features/workspace/` — renders `TabBar` + all tab contents mounted (non-selected `hidden`/parked); Chat tab content = `<ChatPage />`; ext tab content = `<ExtViewHost bare visible={selected} />`
- [x] T012 [US1] Mount `<WorkspaceTabs />` as root in `src/renderer/src/main.tsx` (replaces `<ChatPage />`); hook inside WorkspaceTabs does `extension.scan` on mount → `deriveTabs`

**Checkpoint**: quickstart S1–S3 manually verifiable in dev window.

---

## Phase 4: US2 — Tabs follow the pack lifecycle live (P1)

**Goal**: enable/disable/remove/restart changes reflect in the tab bar in-session.

**Independent test**: disable an enabled pack → its tab closes + selection falls to Chat; re-enable → tab returns auto-selected; restart → tabs restored, Chat stays selected (quickstart S4/S5).

- [x] T013 [US2] Subscribe `extension.changed` in `use-workspace-tabs.ts` — re-derive + `reconcile` selection (auto-select on enable transition; fallback `"chat"` when selected tab vanishes)
- [x] T014 [US2] Startup restore keeps `selectedId="chat"` — covered by `reconcile` rule; assert in `tests/workspace-tabs.test.ts` (initial derive never selects ext tab)
- [x] T015 [US2] Retire drawer auto-open for `tab`-slot views in `src/renderer/src/features/extensions/ExtensionsPanel.tsx` — `afterEnable` keeps `onBrowse` only; the tab itself now surfaces via `extension.changed` (research D5). Panel-only packs also drop enable-time auto-open — enable browses; panels open manually (spec A7)
- [x] T016 [US2] Browse → Open on a `tab`-slot view selects its top tab instead of opening a drawer host — route `WorkspaceBrowser.onOpenView` through `WorkspaceTabs` selection in `src/renderer/src/features/chat/ChatPage.tsx` (FR-013); `panel`-slot views keep the drawer `ExtViewHost`

**Checkpoint**: quickstart S4–S6.

---

## Phase 5: US3 — Tab identity & crash signals (P2)

**Goal**: each tab is identifiable by pack, and a crashed extension view stays contained in its tab.

**Independent test**: open `crash-view-pack` tab → contained crash + Reload inside the tab; other tabs unaffected (quickstart S7).

- [x] T017 [P] [US3] Verify + adjust tab tooltips `<title> — <packName>` and empty-title fallback in `TabBar.tsx` (FR-004/FR-009)
- [x] T018 [US3] Surface crash state on the tab itself — crashed session marks its tab (dot/tint via `view.error` session→tab mapping in `WorkspaceTabs.tsx`); contained crash + Reload render inside the tab per `contracts/tabs.md` (FR-008)

**Checkpoint**: quickstart S7 + S9 overflow scroll.

---

## Phase 6: Polish & Cross-Cutting

- [x] T019 Live-walk quickstart S1–S9 in `bun run dev`; record outcomes in `specs/019-extension-ui-tabs/validation.md`
- [x] T020 Update `AGENTS.md` — module map note: `features/workspace/` tab bar, `view.setVisible`, parking semantics
- [x] T021 Gates: `bunx tsc --noEmit` · `bun test ./tests` · `bun run lint` · `bun run build:renderer`

---

## Dependencies

- T002–T007 (foundational) block all stories.
- **US1** (T008–T012) blocks **US2** (needs the tab bar + host to sync) and **US3** (needs tabs to badge).
- **US2** and **US3** are independent of each other after US1.
- [P] tasks share no files: T002/T004/T006/T007 all parallel; T009 parallel with T010.

## Parallel execution examples

- Foundational: T002 + T004 + T006 + T007 in one batch.
- US1: T009 (TabBar) ∥ T010 (ExtViewHost) after T008.

## MVP scope

US1 alone = a working peer-tab workspace (S1–S3). US2 makes it honest (live sync). US3 is polish.

## Format validation

All tasks: checkbox + sequential ID + [P] only where parallel-safe + [USx] labels only in story phases + explicit file paths.

---

## Phase 7: Convergence

- [x] T022 Clear stale crash badges in `src/renderer/src/features/workspace/WorkspaceTabs.tsx` — remove a tab id from `crashed` when its view reloads successfully (`ExtViewHost` `open()` resolves; add a recovery callback prop) and prune ids for tabs that vanished per FR-008 / US3-AC1 (partial)
- [x] T023 Guard `useWorkspaceTabs` in `src/renderer/src/features/workspace/use-workspace-tabs.ts` so `reconcile` only runs after the initial `extension.scan` baseline has seeded — an `extension.changed` mid-startup must not auto-select a restored tab per FR-006 (partial)
- [ ] T024 Complete the live quickstart walkthrough for pending scenarios S2/S3/S6/S7/S9 in `bun run dev` and update `specs/019-extension-ui-tabs/validation.md` per T019 (partial)
- [ ] T025 Map SC-001…SC-005 to evidence in `validation.md`; SC-001/SC-005 (1 s timing) and SC-003 (no visible reload) are manual checks — record how each was observed
