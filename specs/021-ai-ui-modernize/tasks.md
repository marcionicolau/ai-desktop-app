# Tasks: Unified Component Layer & UX Refresh

**Input**: Design documents from `specs/021-ai-ui-modernize/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/theme.md, contracts/components.md

**Tests**: `tests/ui-audit.test.ts` is a NEW required test (enforces SC-001). Existing `bun test ./tests` suite is the regression baseline.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Path Conventions

- Renderer: `src/renderer/src/`; shared: `src/shared/`; bun: `src/bun/`; tests: `tests/`

---

## Phase 1: Setup

- [x] T001 Install new primitive deps in `package.json`: `bun add @radix-ui/react-collapsible @radix-ui/react-tooltip @radix-ui/react-separator @radix-ui/react-dropdown-menu @radix-ui/react-progress @radix-ui/react-sheet @radix-ui/react-popover` — pin resolved versions in `bun.lock` (research.md R12 maps each to its recipe; hover-card intentionally absent — deferred)
- [x] T002 Scaffold the token system in `src/renderer/src/index.css`: `@custom-variant dark (&:where(.dark, .dark *))`, `:root` light token set + `.dark` refined dark set covering the full contract palette (`--background --foreground --card --card-foreground --popover --popover-foreground --primary --primary-foreground --secondary --secondary-foreground --muted --muted-foreground --accent --accent-foreground --destructive --destructive-foreground --border --input --ring --sidebar --sidebar-foreground --sidebar-accent --sidebar-accent-foreground --sidebar-border --sidebar-ring --radius`) + type scale tokens (research.md R10); existing `--color-*` names remap onto the new tokens so current utilities keep resolving

## Phase 2: Foundational (blocks all stories)

- [x] T003 [P] Vendor base ui primitives in `src/renderer/src/components/ui/`: `collapsible.tsx`, `tooltip.tsx`, `separator.tsx`, `dropdown-menu.tsx`, `progress.tsx`, `popover.tsx` — forwardRef + `cn` conventions per `alert-dialog.tsx` (contracts/components.md)
- [x] T004 [P] Vendor markup primitives in `src/renderer/src/components/ui/`: `badge.tsx` (cva variants), `card.tsx`, `kbd.tsx`, `skeleton.tsx`, `breadcrumb.tsx`
- [x] T005 Vendor `src/renderer/src/components/ui/trace.tsx` — Trace/TraceCollapsible/TraceCollapsibleTrigger/TraceCollapsibleContent/TraceLine/TraceIcon/TraceTitle/TraceDescription composition per ai-elements chain-of-thought recipe, built on `ui/collapsible` + `ui/badge`
- [x] T006 Write `tests/ui-audit.test.ts` — headless file-scan test enforcing data-model audit rules: (a) zero `@radix-ui/*` imports under `src/renderer/src/` outside `components/ui/`; (b) zero raw color literals (`#hex`, `oklch(`, `rgb(`, `hsl(`) outside `index.css`; (c) new `components/ui/*.tsx` export wrappers. Must pass on day one (imports already clean); color-literal violations found now get tracked for the US3 migration tasks
- [x] T007 Extend `Settings` in `src/shared/types.ts` with `themeMode?: "system" | "light" | "dark"` (default `"system"` when absent) + persist in `src/bun/store/json-store.ts` settings plumbing (same path as `outputPanel`, feature 016)

**Checkpoint**: `bunx tsc --noEmit` + `bun test ./tests` green (audit test included)

---

## Phase 3: User Story 1 — Single component layer (P1)

**Goal**: enforced wrapper boundary (FR-001/FR-002).

**Independent Test**: `tests/ui-audit.test.ts` passes; manual `rg "@radix-ui" src/renderer/src --glob '!components/ui/**'` empty.

- [x] T008 [US1] Audit-fix pass: run the T006 test; migrate any direct primitive imports or missing wrappers it flags into `components/ui/` wrappers (expected: none for imports — confirm and document in validation notes)
- [x] T009 [US1] Audit-fix pass: catalog raw color literals flagged by T006 rule (b) and open `specs/021-ai-ui-modernize/validation.md` listing each site + its US3 token replacement target (migration itself happens in US3; this task produces the inventory)

**Checkpoint**: audit test green; inventory file lists remaining literal sites

---

## Phase 4: User Story 2 — AI surfaces get purpose-built components (P1)

**Goal**: adopted ai-elements set live (FR-003/FR-004/FR-005/FR-006); every existing capability preserved.

**Independent Test**: quickstart.md S2 — fusion turn shows collapsible plan trace; tool call shows confirmation; composer/context/selector/tree all render.

- [x] T010 [US2] Build `src/renderer/src/components/ai/message.tsx` — Message/Turn composition (role-aware layout, actions slot, attachment chips) and migrate `src/renderer/src/components/ai/ai-message.tsx` onto it; update `src/renderer/src/features/chat/MessageList.tsx` to render turns via it (markdown/code-block/regenerate/edit/variants preserved, FR-006)
- [x] T011 [US2] Add scroll-anchoring to `src/renderer/src/features/chat/MessageList.tsx` (Chat/Message-Scroller pattern: stick to bottom while streaming unless user scrolled up; research.md R5)
- [x] T012 [US2] Build `src/renderer/src/components/ai/prompt-input.tsx` and migrate `src/renderer/src/features/chat/Composer.tsx` onto it — attachments chips, `/`-snippet insertion, send/stop, model-load shortcut all retained (FR-005)
- [x] T013 [US2] Build `src/renderer/src/components/ai/tool.tsx` + `stack-trace` part + `confirmation.tsx`; rebuild `src/renderer/src/features/chat/ToolCallCard.tsx` onto them — pending→approve/deny/allowSession becomes the Confirmation prompt, failed calls show Stack Trace (FR-004)
- [x] T014 [US2] Build `src/renderer/src/components/ai/chain-of-thought.tsx` (TraceCollapsible summary + Trace steps) and render fusion `phases.plan` inside it in `src/renderer/src/features/chat/MessageList.tsx`/message path — running→done/failed per-phase status, collapsible (FR-004)
- [x] T015 [US2] Build `src/renderer/src/components/ai/reasoning.tsx` (streaming thinking display) and use it for in-flight planner/phase text
- [x] T016 [US2] Build `src/renderer/src/components/ai/suggestion.tsx` and render snippet/persona picks as suggestion chips in the Composer area (data from `usePersonas`; one click inserts — FR-005 related)
- [x] T017 [P] [US2] Build `src/renderer/src/components/ai/checkpoint.tsx` and rebuild `src/renderer/src/features/chat/VariantNav.tsx` + `BranchOverview.tsx` onto it (return-point affordance)
- [x] T018 [P] [US2] Build `src/renderer/src/components/ai/context.tsx` — token-usage chip using `message.stats.promptTokens` + model context size; render in prompt-input footer / `src/renderer/src/features/metrics/OutputPanel.tsx` (hidden when data unavailable, research.md R7)
- [x] T019 [P] [US2] Build `src/renderer/src/components/ai/task.tsx`/`queue.tsx`/`subagent.tsx` (Trace compositions) and rebuild `src/renderer/src/features/extensions/RunView.tsx` run steps onto them (running/complete/failed per step)
- [x] T020 [P] [US2] Build `src/renderer/src/components/ai/file-tree.tsx` and apply to `src/renderer/src/features/extensions/WorkspaceBrowser.tsx` file/agent-tree rendering
- [x] T021 [US2] Build `src/renderer/src/components/ai/model-selector.tsx` (two-menu pattern: model + role/tag) and mount in the inset header — planner/executor tag pickers in fusion mode, "Manage…" opens `ModelLibrary` (research.md R6)
- [x] T022 [US2] Token-align `src/renderer/src/components/ai/code-block.tsx` to registry affordances (language label, copy) — no shiki (research.md R11)

**Checkpoint**: quickstart S2 scenarios all render; `bunx tsc --noEmit` + `bun test ./tests` green

---

## Phase 5: User Story 3 — Visual refresh (P2)

**Goal**: light+dark themes with persisted override (FR-007/FR-008/FR-009/FR-011).

**Independent Test**: quickstart.md S3 — OS switch repaints app + extension views; override persists across restart; reduced-motion/narrow-window pass.

- [x] T023 [US3] Wire theme resolution in the renderer (`src/renderer/src/lib/theme.ts`): read `themeMode` via `settings.get`, resolve `"system"` via `matchMedia("(prefers-color-scheme: dark)")` + change listener, toggle `.dark` on the root element (contracts/theme.md)
- [x] T024 [US3] Add a theme control (light/dark/system) in `src/renderer/src/features/settings/` surfaces persisting via `settings.set` (FR-009)
- [x] T025 [US3] Broadcast resolved theme to extension views: `src/bun/rpc/handlers.ts` `settings.set` path pushes `{mode, vars}` via `ViewManager.pushTheme` to all open sessions when `themeMode` changes; `view.open` seeding already calls pushTheme — update it to send the resolved mode + real token vars (contracts/theme.md, FR-008)
- [x] T026 [US3] Migrate hardcoded styling to tokens across `src/renderer/src/features/**` — replace raw literals + non-semantic palette classes (`text-amber-400`, `bg-amber-950`, `text-red-300`…) with semantic tokens/warning-destructive variants per the T009 inventory (FR-007)
- [x] T027 [US3] Media-query pass: `motion-reduce:` guards on all animations app-wide + narrow-window resilience check for panels/dialogs (FR-011)

**Checkpoint**: quickstart S3 passes; audit rule (b) fully green after T026

---

## Phase 6: User Story 4 — Sidebar app shell (P2)

**Goal**: sidebar-05 organization (FR-012/FR-013/FR-014/FR-015).

**Independent Test**: quickstart.md S4 — collapse to icon rail + keyboard toggle, grouped nav works, workspace state survives toggles.

- [x] T028 [US4] Vendor `src/renderer/src/components/ui/sidebar.tsx` + `sheet.tsx` (sheet vendored in T028 if not yet present) — SidebarProvider/Sidebar/SidebarInset/SidebarTrigger/group/menu/rail + localStorage collapse persistence + keyboard shortcut (research.md R3)
- [x] T029 [US4] Build `src/renderer/src/features/chat/AppSidebar.tsx` (replaces `Sidebar.tsx`): search form, collapsible Chats group (existing select/new/rename/delete/import/export behavior), collapsible Extensions group (enabled packs → `focusView`/`select` workspace panel + "Manage extensions…" → ExtensionsPanel), footer entries (Settings, Model Library, Personas, Roles) — contract in contracts/components.md
- [x] T030 [US4] Restructure `src/renderer/src/features/chat/ChatPage.tsx` `<main>` → `SidebarProvider` + `AppSidebar` + `SidebarInset`; header moves into inset with `SidebarTrigger` + context label, mounting `ai/model-selector` (T021); workspace panels are the main surface (full-screen mounted-hidden items; accordion chrome removed per UX feedback)
- [x] T031 [US4] Chat layout conventions in the workspace: transcript column capped at readable width (centered) at wide windows; Composer anchored at bottom (FR-014)
- [x] T032 [US4] Verify collapse/expansion preserves workspace panel state + live BrowserView sessions (FR-015); old `Sidebar.tsx` deleted once AppSidebar is wired

**Checkpoint**: quickstart S4 passes; all panels/surfaces reachable via new nav

---

## Phase 7: Polish & Cross-Cutting

- [x] T033 [P] Update `AGENTS.md` — component layer rules (ui/ = only radix home, ai/ = recipes), theme tokens, sidebar shell, audit test
- [x] T034 Full gates: `bunx tsc --noEmit`, `bun test ./tests`, `bun run lint`, `bun run build:renderer` — green
- [ ] T035 Live-validate `quickstart.md` S1–S4; record results + light/dark screenshots in `specs/021-ai-ui-modernize/validation.md`

---

## Dependencies & Execution Order

```text
Phase 1 (T001–T002: deps + tokens)
  → Phase 2 (T003–T007: primitives, trace, audit test, themeMode type)
  → Phase 3 US1 (T008–T009: audit passes + literal inventory)
  → Phase 4 US2 (T010–T022: ai components + migrations)   [heaviest]
  → Phase 5 US3 (T023–T027: theme wiring + literal migration)
  → Phase 6 US4 (T028–T032: sidebar shell)
  → Phase 7 (T033–T035)
```

**Story dependencies**: US2 needs Phase 2 primitives; US3 needs T009's inventory + Phase 1 tokens; US4 needs T021's model selector (mounted in T030) — cross-story dependency noted, T021 can ship without T030 (selector just isn't mounted until then).

### Parallel opportunities

- T003 ∥ T004 (different files, both vendoring)
- T017 ∥ T018 ∥ T019 ∥ T020 (independent ai components)
- Within US2, T010–T015 are sequential-ish (same MessageList/Composer neighborhood)

## Implementation Strategy

**MVP = Phases 1–4** (Setup + Foundational + US1 + US2): the enforced component layer + AI surfaces are the P1 user value. US3 (themes) and US4 (sidebar) are P2 layering. Live-validation checkpoints: quickstart S-scenarios at each phase boundary.

---

## Phase 8: Convergence

- [x] T036 Build `src/renderer/src/components/ai/checkpoint.tsx` (return-point affordance recipe) and rebuild `src/renderer/src/features/chat/VariantNav.tsx` + `src/renderer/src/features/chat/BranchOverview.tsx` onto it — both files are still hand-rolled pre-021 components per T017 / FR-003 (missing)
- [x] T037 Define the bounded typography scale (`--text-*` size/weight/line-height tokens, ≤8 steps) in `src/renderer/src/index.css` `@theme inline` and reference it in the audit/docs per FR-007 / SC-004 / T002 (partial)
- [x] T038 Reconcile stale artifacts with the user-directed panel model: update `spec.md` (FR-010/FR-015), `tasks.md` T029–T032 wording, `plan.md` structure section, and `AGENTS.md` to describe full-screen mounted-hidden workspace panels + sidebar tab chrome instead of the workspace accordion; record the consolidated ai-file naming (Task/Queue/Subagent→`task.tsx`, SuggestionChips→`prompt-input.tsx`, Tool/Confirmation/StackTrace→`tool-call.tsx`, chain-of-thought/reasoning→inline `TraceCollapsible`) and skipped `sheet.tsx`/`popover.tsx` per FR-010 / T030 / T032 (contradicts)
- [x] T039 Promote the conversation search field to a top-level sidebar search form (sidebar-05 pattern) in `src/renderer/src/features/chat/AppSidebar.tsx`, or accept the in-group placement and amend FR-013 text per FR-013 / US4/AC2 (partial)
