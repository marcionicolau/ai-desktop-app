# Tasks: Workspace Tabs — Accordion UX

**Input**: Design documents from `specs/020-tabs-accordion-ux/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/accordion.md

**Tests**: existing `tests/workspace-tabs.test.ts` is the regression suite (model unchanged); no new tests requested by the spec.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Path Conventions

- Renderer: `src/renderer/src/`; shared types: `src/shared/`; tests: `tests/`

---

## Phase 1: Setup

- [ ] T001 Install the accordion primitive: `bun add @radix-ui/react-accordion@latest` in `package.json` — pin to the resolved version in `bun.lock` (§VI justification in plan.md: `forceMount` keep-alive + roving keyboard nav + ARIA, consistent with the existing `@radix-ui/react-*` deps)
- [ ] T002 Add accordion animation CSS to `src/renderer/src/index.css`: `accordionDown`/`accordionUp` keyframes animating `height: 0 ↔ var(--radix-accordion-content-height)` (~250–300 ms `ease-out`), plus Tailwind v4 utilities `animate-accordion-down`/`animate-accordion-up` usable as `data-[state=open]`/`data-[state=closed]` classes, each guarded by `motion-reduce` so reduced-motion users get instant transitions (FR-005)

---

## Phase 2: Foundational (blocks all stories)

- [ ] T003 Create the shadcn wrapper `src/renderer/src/components/ui/accordion.tsx` exporting `Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionContent` — `forwardRef` + `cn` over `AccordionPrimitive.*`, mirroring `src/renderer/src/components/ui/alert-dialog.tsx` conventions; `AccordionContent` accepts `forceMount` and applies the `data-[state]` animation classes from T002 plus `overflow-hidden` (contract: `contracts/accordion.md`)

**Checkpoint**: `bunx tsc --noEmit` clean — primitive ready for the rewrite

---

## Phase 3: User Story 1 — Workspace surfaces animate instead of snapping (P1)

**Goal**: vertical stack of expandable items — Chat first, one item per `ext`/`pack` surface — exactly one expanded, animated content-size transitions (FR-001/FR-003/FR-004), no startup flicker (US1-AC3), keep-alive via `forceMount` (FR-007).

**Independent Test**: views-pack enabled → expand Chat → Results Explorer → notes-pack in turn → each region animates open/closed; first paint after restart shows the expanded surface with no open animation.

- [ ] T004 [US1] Rewrite `src/renderer/src/features/workspace/WorkspaceTabs.tsx` (name stays for now — renamed in US2): replace `<TabBar>` + the `hidden`-toggled `<div>` layers with `<Accordion type="single" collapsible={false} value={selectedId} onValueChange={select}>`; render `chat` first as `AccordionItem value="chat"`, then per `t` — `ext` → `ExtViewHost bare visible={selectedId === t.id}` inside `AccordionContent forceMount`, `pack` → `WorkspaceBrowser` + `RunView` inside `AccordionContent forceMount`; keep the existing `crashed` Set logic, `markCrashed`/`clearCrashed`, prune-on-vanish effect, `onClose={() => select("chat")}`, and all props unchanged
- [ ] T005 [US1] Layout + scroll in `src/renderer/src/features/workspace/WorkspaceTabs.tsx`: root `min-h-0 flex-1 overflow-y-auto`, each `AccordionItem` as flow children; expanded `AccordionContent` fills remaining column space (`flex-1 min-h-0` + `h-full` inner) so MessageList/ExtViewHost aren't shrink-to-content — if `--radix-accordion-content-height` fights the fill layout, switch the content wrapper to the `grid-template-rows: 0fr→1fr` transition fallback (research.md R3)
- [ ] T006 [US1] Verify animation correctness in `src/renderer/src/index.css` + the component: closed items must be `hidden` at exit end (Radix applies it post-animation with `forceMount`), first render with initial `value` plays no open keyframes (US1-AC3), rapid `value` changes interrupt cleanly (FR-006) — adjust animation classes/overflow as needed, no JS animation timing logic

**Checkpoint**: S1/S2/S4/S5(restart) of `quickstart.md` pass live in `bun run dev`; `bunx tsc --noEmit` + `bun test ./tests` green

---

## Phase 4: User Story 2 — Workspace components are named for their role (P2)

**Goal**: names describe rendered role (FR-008); no user-visible change.

**Independent Test**: code review — each export identifies its role without opening the file.

- [ ] T007 [US2] Rename `src/renderer/src/features/workspace/WorkspaceTabs.tsx` → `src/renderer/src/features/workspace/WorkspaceAccordion.tsx` (`git mv`); component `WorkspaceTabs` → `WorkspaceAccordion`; update the file's header comment to describe the accordion workspace
- [ ] T008 [US2] Rename `src/renderer/src/features/workspace/use-workspace-tabs.ts` → `src/renderer/src/features/workspace/use-workspace-items.ts` (`git mv`); hook `useWorkspaceTabs` → `useWorkspaceItems` (same signature `{ tabs, selectedId, select, focusView }`)
- [ ] T009 [US2] Update all references: `src/renderer/src/features/chat/ChatPage.tsx` imports (`WorkspaceAccordion`, `useWorkspaceItems`) and `<WorkspaceTabs …>` usage; `src/renderer/src/features/workspace/tab-model.ts` and `tests/workspace-tabs.test.ts` keep names — data model, not components (spec A4)
- [ ] T010 [US2] Delete `src/renderer/src/features/workspace/TabBar.tsx` — its trigger row is absorbed by `AccordionItem`/`AccordionTrigger`; confirm no remaining imports (`rg TabBar src/`)

**Checkpoint**: `rg "WorkspaceTabs|useWorkspaceTabs|TabBar" src/` returns zero hits; `bunx tsc --noEmit` + `bun test ./tests` green

---

## Phase 5: User Story 3 — Tab interactions keep their polish and gain affordances (P2)

**Goal**: all 019 affordances on accordion triggers (FR-010) + keyboard navigation (FR-009).

**Independent Test**: disable/re-enable a pack mid-session → item closes/opens; hover trigger → pack tooltip; crash a view → `●` on trigger; arrows + Enter/Space navigate/expand.

- [ ] T011 [US3] Trigger affordances in `src/renderer/src/features/workspace/WorkspaceAccordion.tsx`: inside each `AccordionTrigger` render the same chrome as old TabBar — `title` tooltip (`"title — packName"`, `chat` → "Chat"), crash `●` indicator from the `crashed` set, × button (`stopPropagation` → `onCloseTab(packId)`) on `ext`/`pack` items only — Chat's trigger has no close affordance (FR-002)
- [ ] T012 [US3] Trigger styling in `src/renderer/src/features/workspace/WorkspaceAccordion.tsx` + `components/ui/accordion.tsx`: selected-state styling via `data-state=open`, `focus-visible` ring, hover state; keep headers compact rows (text truncation for long titles)
- [ ] T013 [US3] Verify keyboard nav works through Radix in `src/renderer/src/features/workspace/WorkspaceAccordion.tsx` (roving focus + ↑/↓/←/→, Home/End, Enter/Space toggles — free from the primitive); only add code if a wrapped affordance (the × button) traps focus — ensure × is `tabIndex` reachable but doesn't steal arrow-key handling

**Checkpoint**: S3/S5–S9 of `quickstart.md` pass; `bunx tsc --noEmit` + `bun test ./tests` green

---

## Phase 6: Polish & Cross-Cutting

- [ ] T014 [P] Strip feature-019 debug instrumentation: remove the temporary `console.log` diagnostics in `src/bun/rpc/handlers.ts` and `src/renderer/src/features/extensions/ExtViewHost.tsx` (research.md R9 — re-add briefly only if the blank-view symptom recurs)
- [ ] T015 [P] Update `AGENTS.md` workspace module map entry: `TabBar`/`WorkspaceTabs` → `WorkspaceAccordion`/`use-workspace-items`/`components/ui/accordion.tsx`
- [ ] T016 Run full gates: `bunx tsc --noEmit`, `bun test ./tests`, `bun run lint`, `bun run build:renderer` — all green (lint may keep pre-existing warnings)
- [ ] T017 Live-validate `quickstart.md` S1–S9 in `bun run dev`; record results in `specs/020-tabs-accordion-ux/validation.md` (animation smoothness, state preservation, keyboard nav, crash badge, reduced-motion if settable)

---

## Dependencies & Execution Order

```text
Phase 1 (T001–T002) ──→ Phase 2 (T003) ──→ Phase 3 US1 (T004–T006)
                                          ──→ Phase 4 US2 (T007–T010) [needs US1's file in place to rename]
                                          ──→ Phase 5 US3 (T011–T013) [needs US1's accordion items to style]
Phase 6 (T014–T017) after all stories
```

**Story dependencies**: US1 is the only user-visible foundation — US2 renames the files US1 creates/edits, US3 styles the triggers US1 creates. Stories are sequential, not independent here (presentation-layer rewrite of one component).

### Parallel opportunities

- T014 ∥ T015 (different files, both polish)
- Within US3: T011–T013 touch the same file — sequential by nature

## Implementation Strategy

**MVP = Phase 1–3** (Setup + Foundational + US1): the animated vertical accordion is the whole ask; renames (US2) and affordance polish (US3) layer on without changing behavior. Live-validation gates: `quickstart.md` checkpoint after each phase.
