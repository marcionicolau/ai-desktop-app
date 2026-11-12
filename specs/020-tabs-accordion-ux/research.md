# Research: Workspace Tabs — Accordion UX

## R1: Accordion primitive

**Decision**: `@radix-ui/react-accordion` wrapped as `components/ui/accordion.tsx` (shadcn convention — `forwardRef` + `cn`, mirroring `alert-dialog.tsx`).

**Rationale**: the spec needs `forceMount` (FR-007 keep-alive), roving keyboard navigation (FR-009), and ARIA wiring — all bundled in the primitive; the project already ships three radix packages, so the dependency layer is established. §VI justification recorded in plan.md.

**Alternatives**: hand-rolled expand/collapse (~50 LOC) — rejected: reimplements focus/ARIA/keyboard handling for no dep saving that matters; Radix Tabs — rejected: user explicitly chose the accordion form (vertical stacked items).

## R2: Root configuration

**Decision**: `Accordion.Root type="single" collapsible={false}` + `value={selectedId}` + `onValueChange={select}`.

**Rationale**: exactly one item expanded (tab semantics, spec clarification A); `collapsible={false}` guarantees a surface is always expanded — matches "Chat selected by default / one tab always active".

## R3: Content-size animation

**Decision**: primary = Radix-documented `--radix-accordion-content-height` keyframes (`accordionDown`/`accordionUp`, ~250–300 ms `ease-out`), vendored as CSS in `index.css`. Fallback if the var-measured height fights the fill-layout: `grid-template-rows 0fr→1fr` transition on the content element with an `overflow-hidden` inner wrapper — the docs' own alternative and handles `flex`-sized regions.

**Rationale**: user's linked docs section is the canonical pattern; keyframes keep the open end-state free to be `flex-1` sized (MessageList/ExtViewHost must fill remaining space, not shrink-to-content).

## R4: Keep-alive + native view parking

**Decision**: `AccordionContent forceMount` on every item — React state + DOM persist when closed (Radix applies `hidden` post-exit-animation). `ExtViewHost` gets `visible = expanded` — on collapse → `view.setVisible(false)` parks the native view; on expand → lazy-open/unpark + ResizeObserver re-push (existing 019 wiring, unchanged).

**Rationale**: accordion unmounts closed content by default, which would destroy `ExtViewHost` state and kill sessions (violates FR-007). `forceMount` + `visible`-gated parking is the same contract the tab strip used.

**Refinement noted**: parking fires at collapse-start (instant native hide while the container animates closed). Acceptable v1; a smoother variant defers parking to animation-end — revisit if it looks abrupt.

## R5: Startup flicker + rapid switching

**Decision**: rely on Radix — initial `value` renders open without playing the open keyframes (no startup flicker, US1-AC3); rapid `value` changes interrupt cleanly (latest wins, FR-006). No extra code.

## R6: Reduced motion

**Decision**: `motion-reduce:` variant on the animation classes (`motion-reduce:animate-none` / `motion-reduce:transition-none`) — FR-005, one Tailwind utility per animated element.

## R7: Component names (FR-008, spec A1)

**Decision**: `WorkspaceTabs.tsx` → `WorkspaceAccordion.tsx`; `TabBar.tsx` deleted (headers live inside `AccordionItem`/`AccordionTrigger`); `use-workspace-tabs.ts` → `use-workspace-items.ts` (`useWorkspaceItems`). `tab-model.ts` + `deriveTabs`/`reconcile` keep names — data model, not components (A4).

## R8: Scroll + overflow

**Decision**: `Accordion.Root` sits in a `min-h-0 flex-1 overflow-y-auto` region; headers are normal flow children, expanded content `flex-1`. Many items scroll vertically — replaces horizontal overflow handling (FR-010).

## R9: Blank extension view (019 leftover)

**Decision**: keep the measured-rect spawn fix (`view.open rect`) — the accordion host still measures `ref.current` at open. The temporary `console.log` instrumentation in `handlers.ts`/`ExtViewHost.tsx` is stripped during this feature's implementation. If the blank-view symptom recurs under the accordion host, the logs go back in briefly — no spec change needed.
