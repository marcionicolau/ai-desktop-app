# Tasks: Interface Usability Overhaul

**Input**: Design documents from `/specs/026-ux-interface-overhaul/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: The spec does not request TDD. The enforcement tests below (`ui-audit`, `ui-contrast`, notify/actions/density) are deliverables of the feature, not a test-first mandate.

**Organization**: Grouped by user story. US2 precedes US1 because the app-wide token swap (plan slice S1) must land first; both are P1. Slice labels (S0–S6) map to plan.md. Work merges in stages; only the closing release must have zero old-look leftovers.

## Format: `- [ ] T### [P?] [US?] (FR-…) Description with file path`

- **[P]**: can run in parallel (different files, no dependency on incomplete tasks)
- Paths are relative to the repo root; renderer root is `src/renderer/src/`

## Phase 1: Setup & Visual-Direction Gate (slice S0)

- [X] T001 Write the scripted walkthrough (5 core tasks: start chat, switch model, change a generation setting, import a file, delete a conversation; each with start/stop state, timer and pass/fail checklist) in `specs/026-ux-interface-overhaul/walkthrough.md` Include a sixth step, "reach a named conversation, a model and a setting from any screen", timed with keystroke count (SC-003) (SC-002, SC-003, SC-004)
- [ ] T002 Run the walkthrough on current `main` and record the baseline times and results in `specs/026-ux-interface-overhaul/validation.md` — **must be done before any visual change merges** (SC-002, SC-004)
- [X] T003 [P] Build candidate sample A "Graphite" as standalone light+dark HTML (chat, settings form, empty state, toast, command palette mock) in `specs/026-ux-interface-overhaul/candidates/a-graphite.html` per research.md R1 (FR-021)
- [X] T004 [P] Build candidate sample B "Paper" in `specs/026-ux-interface-overhaul/candidates/b-paper.html` (FR-021)
- [X] T005 [P] Build candidate sample C "Midnight" in `specs/026-ux-interface-overhaul/candidates/c-midnight.html` (FR-021)
- [X] T006 **Gate G0**: owner picks one candidate; record the decision (palette values, font pair, icon family) in `specs/026-ux-interface-overhaul/research.md` R1. Blocks T015–T018. (FR-021)
- [X] T007 [P] Check whether Electrobun `BrowserWindow` supports a minimum size in `src/bun/index.ts` (currently only `frame: {width: 1024, height: 720}`); record the result in research.md R7 (FR-015)

## Phase 2: Foundational (blocks all user stories)

- [X] T008 Vendor the shadcn components needed (`dialog`, `select`, `switch`, `slider`, `tabs`, `command`, `sonner`, `field`, `label`, `checkbox`, `radio-group`, `popover`, `empty`, `spinner`, `alert`) into `src/renderer/src/components/ui/` with the shadcn CLI per `src/renderer/components.json`; Radix imports only inside `ui/` Set `iconLibrary` in `src/renderer/components.json` to the family approved in T006 before vendoring (FR-020) — *done: vendored from the shadcn `new-york-v4` registry (`shadcn view`; the CLI cannot run without a renderer `package.json`); imports adapted to `@/lib/utils`, `sonner` uses `@/lib/theme`; `Button` gained an `outline` variant; `iconLibrary` set to `remix`*
- [X] T009 Add `sonner` and `cmdk` to `package.json` and `bun.lock`, with the justification from plan.md Complexity Tracking in the commit message (FR-020)
- [X] T010 [P] Extend `tests/ui-audit.test.ts` with scale rules in warn-only mode: no arbitrary `text-[Npx]`, no off-scale `size-*` icon sizes, icons imported only via `components/icons.ts`, no native `<select>`/checkbox/radio/range or `fixed inset` overlays outside `components/ui/` (FR-006, FR-008, FR-020)
- [X] T011 [P] Enable the oxlint `jsx-a11y` rules in the project lint config first in warn mode to size the existing violations, then fix or list them (FR-005, FR-022)

**Checkpoint**: foundation ready; user stories can start (US2 after G0).

## Phase 3: User Story 2 — Readable, comfortable visual design (P1) — slice S1 🎯 MVP

**Goal**: new palette, fonts and icon family applied app-wide on one defined scale, AA contrast in both themes.

**Independent Test**: audit every surface in light + dark → AA contrast, only scale values, one icon per concept, minimum target sizes.

- [X] T012 [US2] Replace the color tokens in `src/renderer/src/index.css` (`:root`, `.dark`, `@theme inline`) with the approved palette, including semantic roles (`primary secondary accent destructive success warning info` + `-foreground`) per `contracts/design-tokens.md` (FR-005, FR-009, FR-021)
- [X] T013 [P] [US2] Swap Fontsource packages to the approved UI/reading/mono fonts in `package.json`, `src/renderer/src/main.tsx` and `src/renderer/src/index.css` (`--font-ui --font-reading --font-mono`); remove the old font packages (FR-006, FR-021)
- [X] T014 [P] [US2] Align `src/renderer/src/typeset.css` to the new type scale (6 sizes, 3 weights, line heights) (FR-006) — *fonts and font vars aligned; the 7-step scale (2xs…2xl, 2xs raised to 11 px) is kept from 021*
- [X] T015 [US2] Install the approved icon package and create `src/renderer/src/components/icons.ts` mapping one icon per concept with named sizes `sm` 14 / `md` 16 / `lg` 20 (FR-008)
- [X] T016 [P] [US2] Convert icon imports to `components/icons.ts` in `src/renderer/src/features/chat/*.tsx` and `src/renderer/src/components/ai/*.tsx` (FR-008)
- [X] T017 [P] [US2] Convert icon imports in `src/renderer/src/features/{extensions,update,setup,workspace}/*.tsx` and `src/renderer/src/components/ui/*.tsx` (FR-008)
- [X] T018 [P] [US2] Convert icon imports in `src/renderer/src/features/{models,roles,personas,scripts,settings,metrics}/*.tsx` (FR-008)
- [X] T019 [P] [US2] Replace the 29 arbitrary `text-[10px]`/`text-[11px]` uses with scale steps in `components/ui/kbd.tsx`, `components/ai/context.tsx`, `features/metrics/OutputPanel.tsx`, `features/chat/{MessageList,BranchOverview,ConversationNav}.tsx`, `features/roles/RolesPanel.tsx`, `features/extensions/{WorkspaceBrowser,RunView}.tsx`, `features/personas/PersonasPanel.tsx`, `features/setup/SetupScreen.tsx` (FR-006)
- [ ] T020 [US2] Define distinct hover, focus-visible, active, disabled and busy states and minimum target sizes (24×24 hit area; primary controls ≥ `--control-h-md` 32 px) in `components/ui/{button,input,textarea,badge}.tsx` and the `sidebar`/`dropdown-menu` primitives (FR-007) — *partial: button, input, textarea, badge done (new `--control-h-*`/`--hit-min` tokens, `ring-2 ring-ring`, `aria-busy`, success/warning/info badges); `sidebar` and `dropdown-menu` primitives still pending*
- [X] T021 [P] [US2] Add `tests/ui-contrast.test.ts`: OKLCH→sRGB conversion and WCAG ratio assertions for every foreground/background pair in light, dark and `prefers-contrast: more` (body 4.5:1, large/UI 3:1) (FR-005, SC-001)
- [X] T022 [P] [US2] Add `tests/ui-tokens.test.ts`: assert `--control-h-md` ≥ 32 px and the minimum hit-area token ≥ 24 px in both density sets, and that `--motion-fast`/`--motion-base` resolve to 0 inside the `prefers-reduced-motion: reduce` block of `src/renderer/src/index.css` (FR-007, FR-017)
- [X] T023 [US2] Audit semantic emphasis usage: replace ad-hoc status colors with the shared roles in `features/**` so primary/secondary/destructive/warning/success/info read identically across screens (FR-009)

**Checkpoint**: whole app shows the new identity; `ui-contrast` passes; `ui-audit` warnings for icons and font sizes are zero.

## Phase 4: User Story 1 — Clear, consistent interaction feedback (P1) — slice S2

**Goal**: every action reports progress, outcome and next step through shared patterns.

**Independent Test**: trigger one success, failure, long-running and empty state on at least six surfaces → same patterns, wording and placement.

- [X] T024 [US1] Create `src/renderer/src/lib/notify.ts` (`success`, `error` with recovery `action`, `progress`) over Sonner per `contracts/feedback.md`, and add `tests/renderer/notify.test.ts` (FR-002)
- [X] T025 [US1] Mount the toast host at the app root in `src/renderer/src/main.tsx` / `features/chat/ChatPage.tsx` with `role="status"`/`role="alert"` semantics (FR-002, FR-022)
- [X] T026 [P] [US1] Create `src/renderer/src/lib/confirm.tsx` — `confirm({title, itemName, consequence, confirmLabel})` over `AlertDialog` (FR-004)
- [X] T027 [US1] Inventory every user-initiated action from `src/shared/rpc-contract.ts` into `specs/026-ux-interface-overhaul/action-inventory.md` (action, surface, expected progress, expected failure recovery); T067 maps SC-007 to it (SC-007, FR-001, FR-002)
- [X] T028 [P] [US1] Busy/progress feedback ≤ 200 ms (spinner or progress in the triggering control, control disabled + `aria-busy`) in `features/models/ModelLibrary.tsx` (download, load, benchmark), `features/settings/DataPanel.tsx` (export/import), `features/update/UpdateBanner.tsx`, `features/setup/SetupPanel.tsx` (FR-001) — *done: UpdateBanner (spinner, aria-busy, failed-download toast with Retry), ModelLibrary download failure toast with Retry, RunForm script-run Alert with Retry; ToolCallCard already renders failures in-card*
- [X] T029 [P] [US1] Replace ad-hoc empty states with shadcn `Empty` (reason + primary action) in `features/chat/ConversationNav.tsx`, `features/chat/MessageList.tsx`, `features/models/ModelLibrary.tsx`, `features/roles/RolesPanel.tsx`, `features/personas/PersonasPanel.tsx`, `features/scripts/ScriptsPage.tsx`, `features/extensions/{WorkspaceBrowser,RunView}.tsx` (FR-003)
- [X] T030 [P] [US1] Error states with a recovery action via `notify.error` for chat errors (`features/chat/ChatPage.tsx`), setup failures, import failures (`features/settings/DataPanel.tsx`), tool failures (`features/chat/ToolCallCard.tsx`) and script runs (`features/scripts/ScriptsPage.tsx`) (FR-002) — *done: UpdateBanner (spinner, aria-busy, failed-download toast with Retry), ModelLibrary download failure toast with Retry, RunForm script-run Alert with Retry; ToolCallCard already renders failures in-card*
- [X] T031 [US1] Replace the hand-rolled overlays with shadcn `Dialog`/`Sheet` in `features/setup/SetupScreen.tsx` and `features/chat/ChatPage.tsx` (FR-011, FR-020)
- [X] T032 [P] [US1] Wire `confirm()` into every destructive action naming the item and consequence: delete conversation (`features/chat/ConversationNav.tsx`), remove model (`features/models/ModelLibrary.tsx`), delete persona/role/script (`features/personas/PersonasPanel.tsx`, `features/roles/RolesPanel.tsx`, `features/scripts/ScriptsPage.tsx`), clear data/snapshots (`features/settings/DataPanel.tsx`), remove extension (`features/extensions/ExtensionsPanel.tsx`) (FR-004)
- [X] T033 [P] [US1] Show unavailable controls as disabled with a tooltip stating the reason (e.g. "a model is loading", "no model loaded") in `features/chat/Composer.tsx`, `features/models/ModelLibrary.tsx`, `features/roles/FusionControls.tsx` (FR-019)
- [X] T034 [US1] Announce streaming-reply completion and status changes through a polite live region in `features/chat/MessageList.tsx` (FR-022)
- [X] T035 [P] [US1] Verify several simultaneous toasts stack without hiding the focused control; set the toast visible limit in `src/renderer/src/components/ui/sonner.tsx` and add a case to `tests/renderer/notify.test.ts` (Edge Cases, FR-002)
- [X] T036 [US1] Flip `ui-audit` rules for hand-rolled overlays to errors and add a renderer test for `confirm()` in `tests/renderer/confirm.test.ts` (FR-004, FR-020)

**Checkpoint**: feedback patterns consistent on ≥ 6 surfaces; V3 in quickstart passes.

## Phase 5: User Story 3 — Efficient navigation and keyboard use (P2) — slice S3

**Goal**: reach any conversation, surface or action fast by keyboard; always know where you are.

**Independent Test**: keyboard only — open a conversation by name, new chat, switch model, open settings, return to chat.

- [X] T037 [US3] Create `src/renderer/src/lib/actions.ts` with the `ActionEntry` registry and `shortcutLabel()` per `contracts/actions.md` and data-model.md, plus `tests/renderer/actions.test.ts` (unique ids, `available()` reasons) (FR-010) — *`ACTION_DEFS` + `buildActions(ctx)` (the registry needs live app state, so it is a builder, not a constant)*
- [X] T038 [US3] Create `src/renderer/src/features/command/CommandPalette.tsx` on shadcn `Command` (groups: Conversations via `search.query` / title filter ≥ 3 chars, Navigate, Actions; arrow/Enter/Esc; focus returns on close) (FR-010, FR-011)
- [X] T039 [US3] Add `src/renderer/src/lib/shortcuts.ts` global key handling (`Ctrl/Cmd+K`, `+N`, `+M`, `+,`; existing `+B`) with a conflict check against OS/webview defaults, and confirm or adjust the defaults in `contracts/actions.md` (FR-010)
- [X] T040 [US3] Mount the palette in `features/chat/ChatPage.tsx` and add a trigger with `Kbd` hint to `features/chat/AppSidebar.tsx` (FR-010)
- [X] T041 [P] [US3] Show the shortcut with `Kbd` beside every action that has one (menus, buttons, tooltips) in `features/chat/{Composer,AppSidebar,MessageList}.tsx` (FR-010)
- [X] T042 [P] [US3] Add a shortcuts reference list in `features/settings/ShortcutsSection.tsx` fed by the registry (FR-010)
- [X] T043 [US3] Show location (title or breadcrumb) on every workspace surface in `features/chat/ChatPage.tsx` header and `features/workspace/WorkspacePanels.tsx` (FR-012)
- [X] T044 [US3] Audit focus order and the visible focus ring on every surface; ensure dialogs trap and restore focus and no keyboard trap exists (`features/**`, `components/ui/dialog.tsx`, `alert-dialog.tsx`) (FR-011) — *code-level audit: global `:focus-visible` ring for raw elements, all `ring-1`/`ring-accent` focus styles raised to `ring-2 ring-ring`; Radix dialogs trap and restore focus; a hands-on keyboard walkthrough is still part of T065*

**Checkpoint**: V4 passes; SC-003 measured in T065.

## Phase 5b: User Story 6 — A focused, adjustable workspace (P2) — slice S5b

**Goal**: each chat choice has one control; panels can be resized and the layout is remembered.

**Independent Test**: fusion chat at 1024 × 720 → mode, planner, executor and persona each change from one place; drag the Metrics and sidebar edges → they resize, persist across a restart, and Reset layout restores defaults.

- [X] T071 [US6] Merge the chat setup into one header cluster in `src/renderer/src/features/chat/ChatPage.tsx`: a Single | Fusion toggle, the model selectors (one in single mode, planner and executor in fusion) and the fit status; nothing is repeated below the header (FR-023, FR-024) — *`ChatSetup` cluster (mode toggle, model pills, fit badge, persona pill); the metrics checkbox became a `Switch`*
- [X] T072 [US6] Convert the header persona native `<select>` to the same dropdown pattern as the model selectors (`src/renderer/src/components/ai/model-selector.tsx` or a shared `ChoicePill`), keeping the offer-to-rebind flow (FR-023)
- [X] T073 [US6] Remove the second selector bar: reduce `src/renderer/src/features/roles/FusionControls.tsx` to the mode toggle and a fit badge with a tooltip, and move its error and unbound-role messages into an inline `Alert` under the header; keep the disabled-with-reason behavior (FR-023, FR-024, FR-019) — *`FusionControls.tsx` deleted; the toggle and fit badge live in `ChatSetup`, errors and unbound-role guidance in one inline `Alert`*
- [X] T074 [P] [US6] Add `tests/renderer/chat-setup.test.ts` for the pure pieces: which controls a mode shows (single → 1 model control; fusion → planner + executor), and the fit status text and severity from `fusionFit` figures (FR-023, FR-024)
- [ ] T075 [US6] Vendor shadcn `resizable` into `src/renderer/src/components/ui/resizable.tsx` and add `react-resizable-panels` to `package.json` and `bun.lock`, with the justification from plan.md Complexity Tracking in the commit message (FR-025)
- [ ] T076 [US6] Make the sidebar resizable: drag handle with minimum and maximum widths that keep the icon-rail collapse working, in `src/renderer/src/components/ui/sidebar.tsx` and `src/renderer/src/features/chat/AppSidebar.tsx` (FR-025)
- [ ] T077 [US6] Make the Metrics panel resizable and collapsible: lay the chat column out as a vertical panel group (messages / composer / metrics) in `src/renderer/src/features/chat/ChatPage.tsx` and replace the fixed `h-56` in `src/renderer/src/features/metrics/OutputPanel.tsx` (FR-025, SC-010)
- [ ] T078 [P] [US6] Add `src/renderer/src/lib/layout.ts` (remembered sizes and collapsed state per panel, every storage access in try/catch, values clamped on read) with `tests/renderer/layout.test.ts`, and a "Reset layout" action in `src/renderer/src/lib/actions.ts` plus a button in Settings (FR-026)
- [ ] T079 [US6] Keep extension views positioned while panels resize: throttle `view.setBounds` during a drag in `src/renderer/src/features/extensions/ExtViewHost.tsx` and verify with a hosted view (FR-027)
- [ ] T080 [US6] Check minimum sizes at 800 × 600 (sidebar, metrics, header cluster) and record the measured conversation-area share in `specs/026-ux-interface-overhaul/validation.md` (FR-025, SC-010, SC-011)

## Phase 6: User Story 4 — Forms and settings that are hard to get wrong (P2) — slice S4

**Goal**: controls match data, explain themselves, validate inline, protect unsaved changes.

**Independent Test**: walk every settings/editor form → label, help text, inline validation, units/ranges, unsaved state visible.

- [ ] T045 [US4] Convert `features/settings/GenerationSettings.tsx` to shadcn `Field` with `Slider` + numeric input showing value, unit and allowed range for each parameter, and help text (FR-013)
- [ ] T046 [P] [US4] Replace native selects/checkboxes/radios with `Select`/`Switch`/`Checkbox`/`RadioGroup` (the mode choice at `features/settings/ToolSettings.tsx:86` is a native radio) in `features/settings/{ToolSettings,ScriptsSettings,UpdatesSection}.tsx` (FR-013)
- [ ] T047 [P] [US4] Replace native controls in `features/models/ModelLibrary.tsx` (per-model overrides), `features/roles/{TagEditor,FusionControls}.tsx`, `features/personas/PersonasPanel.tsx`, `features/scripts/{RunForm,ScriptEditor}.tsx` (FR-013)
- [ ] T048 [US4] Inline validation messages that keep the entered value, using the existing server `INVALID_PARAMS` details where available, across the forms above (FR-013)
- [ ] T049 [US4] Create `src/renderer/src/features/settings/use-unsaved-guard.ts`; show a visible "unsaved changes" state and warn (save/discard) on leaving, wired into the settings, persona, role and script editors (FR-013)
- [ ] T050 [US4] Group related settings under headings with in-page navigation in the settings surface (`features/settings/*`, `features/chat/ChatPage.tsx` settings panel) (FR-014)
- [ ] T051 [US4] Flip the `ui-audit` rule for native `<select>`/checkbox/radio/range outside `components/ui/` to an error (FR-020)

**Checkpoint**: V5 passes.

## Phase 7: User Story 5 — Comfortable at any window size and density (P3) — slice S5

**Goal**: usable from 800 × 600 to large displays, with persisted density and OS-preference support.

**Independent Test**: resize 800 × 600 → large, both themes and densities → no clipping, no horizontal page scroll, readable line length.

- [ ] T052 [US5] Add optional `density?: "comfortable" | "compact"` to `Settings` in `src/shared/types.ts` (absent ⇒ comfortable), validate it in `src/bun/rpc/handlers.ts` `settings.set` (any other value ⇒ `INVALID_PARAMS`, no write) and persist in `src/bun/store/json-store.ts`; add `tests/rpc/density.test.ts` per `contracts/settings-density.md` (FR-016)
- [ ] T053 [US5] Create `src/renderer/src/lib/density.ts` (mirrors `lib/theme.ts`, sets `data-density` on `<html>`) and a density control in `features/settings/ThemeSettings.tsx`; register "Toggle density" in `lib/actions.ts` (FR-016)
- [ ] T054 [P] [US5] Define `[data-density="comfortable"|"compact"]` spacing, `--control-h-*` and `--row-pad` token sets in `src/renderer/src/index.css` (FR-016)
- [ ] T055 [US5] Make layouts work at 800 × 600: sidebar icon-rail breakpoint in `features/chat/AppSidebar.tsx`, reflow in `Composer`, `ModelLibrary`, `RolesPanel`, `PersonasPanel`, `ScriptsPage`, `OutputPanel`; no horizontal page scroll (FR-015)
- [ ] T056 [P] [US5] Cap chat line length to a comfortable reading width in `features/chat/MessageList.tsx` and `components/ai/ai-message.tsx` (FR-015)
- [ ] T057 [P] [US5] Honor `prefers-reduced-motion` (motion tokens to 0), `prefers-contrast: more` (high-contrast token set) and `forced-colors` in `src/renderer/src/index.css` (FR-017)
- [ ] T058 [P] [US5] Truncate/wrap long titles, file names and errors with the full text on demand (tooltip) in `features/chat/ConversationNav.tsx`, `features/models/ModelLibrary.tsx`, `features/chat/ToolCallCard.tsx`, `lib/notify.ts` (FR-018)
- [ ] T059 [US5] Apply the minimum window size in `src/bun/index.ts` if T007 found it supported; otherwise record 800 × 600 as a tested floor in `docs/` notes (FR-015)
- [ ] T060 [P] [US5] Verify lists stay responsive and keyboard-navigable with 500+ conversations, models and tool results (palette filter ≤ 100 ms, conversation list scroll); record in `specs/026-ux-interface-overhaul/validation.md` (Edge Cases)
- [ ] T061 [US5] Run the resize matrix (800 × 600, 1024 × 720, 1440 × 900, 1920 × 1080) × both themes × both densities and record results in `specs/026-ux-interface-overhaul/validation.md` (SC-006)

**Checkpoint**: V6 passes.

## Phase 8: Polish & Cross-Cutting (slice S6)

- [ ] T062 Flip every remaining `tests/ui-audit.test.ts` warning (font sizes, icon sizes, icon import site) to an error and confirm zero violations (FR-006, FR-008, SC-005)
- [ ] T063 [P] Run an axe-core pass (browser extension on the Vite dev server) on every surface in both themes; record issues and fixes in `specs/026-ux-interface-overhaul/validation.md` (FR-005, FR-022, SC-001)
- [ ] T064 [P] Manual screen-reader pass on one OS: chat send/receive announcements and an error toast (FR-022, SC-001)
- [ ] T065 Re-run the walkthrough from `walkthrough.md`; record times against the T002 baseline (target: no task slower than baseline; 100% checklist pass) and report the navigation step against the 5 s / 3-keystroke target (SC-002, SC-003, SC-004)
- [ ] T066 Verify "no old-look leftovers": side-by-side review of every surface against the pre-change screenshots; record in `validation.md` (FR-021, SC-009)
- [ ] T067 Write `specs/026-ux-interface-overhaul/validation.md` mapping SC-001…SC-009 to evidence (SC-007: checklist of all user-initiated actions with progress and recovery) (SC-001–SC-009)
- [ ] T068 Add the feature 026 section to `AGENTS.md` (tokens, `icons.ts`, `notify.ts`, `confirm.tsx`, `actions.ts`, density, audit rules) and update the 021 note on the superseded visual identity
- [ ] T069 Run all gates: `bun run typecheck`, `bun run lint`, `bun test ./tests`, `bun run build:renderer` (SC-008); remove the superseded icon/font dependencies and note it in the PR
- [ ] T070 Open the PR with `.github/pull_request_template.md`, listing slices merged and the added dependencies (`sonner`, `cmdk`) with justification

## Dependencies & Execution Order

- Phase 1 → Phase 2 → stories. T002 (baseline) precedes any visual merge; **T006 (G0)** blocks T012–T015.
- US2 (Phase 3) first: the app-wide token swap is the base layer. US1 (Phase 4) depends on T008–T009 and `components/icons.ts` (T015) but not on the final palette values.
- US3 (Phase 5) may run in parallel with US1 (the palette uses `Dialog` from T008); register the "Toggle density" action when T053 lands.
- US4 (Phase 6) depends on `Field`/`Select`/`Slider` (T008) and `lib/notify.ts` (T024).
- US5 (Phase 7) depends on `lib/actions.ts` (T037) for the density action and on US2's tokens.
- Phase 5b (US6) may run in parallel with Phase 5; T071–T073 settle the header before T077 lays out the chat column; T075 precedes T076–T077.
- Polish runs last; T062 requires every conversion task finished.

### Parallel opportunities

- T003–T005 (three candidate samples) and T007 in parallel.
- T010 and T011 in parallel after T008–T009.
- T013, T014, T016–T019, T021 in parallel once T012/T015 exist.
- T026–T030, T032, T033 touch different files and can run in parallel after T024.
- T046 and T047 in parallel; T054, T056, T057, T058 in parallel.
- T063 and T064 in parallel.

## Implementation Strategy

- **MVP**: Phase 1–3 (US2). It delivers the new visual identity and enforced scales app-wide and is the largest single UX change.
- **Increment 2**: US1 feedback layer (largest functional gain). **Increment 3**: US3 + US4. **Increment 4**: US5, then Phase 8 closes the feature.
- Each phase ends at a checkpoint that can merge to `main` independently (staged rollout, clarification 4); the old-look leftover check (T066) gates only the closing release.
