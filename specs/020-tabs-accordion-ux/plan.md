# Implementation Plan: Workspace Tabs — Accordion UX

**Branch**: `020-tabs-accordion-ux` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

## Summary

Replace the horizontal `TabBar` strip from feature 019 with a **vertical accordion workspace**: Chat + each enabled pack item is a stacked `AccordionItem`; exactly one item's `AccordionContent` is expanded at a time (single, non-collapsible = tab semantics). Content-size animation uses the Radix-documented pattern (animated `--radix-accordion-content-height` keyframes, or `grid-template-rows 0fr→1fr` for fill-layout regions). Extension BrowserView sessions survive collapse via `AccordionContent forceMount` + the existing `view.setVisible` parking. Components renamed to accordion roles; new shadcn `components/ui/accordion.tsx` wrapper per constitution §IV/A3.

## Technical Context

**Language/Version**: TypeScript strict, React 19.2, Bun, Electrobun 2.x

**Primary Dependencies**: NEW `@radix-ui/react-accordion` (justified §VI: keyboard nav, focus management, `forceMount` keep-alive, ARIA — all required by FR-007/FR-009; consistent with existing radix deps). Otherwise existing: `deriveTabs`/`reconcile` model, `useWorkspaceTabs` hook, `ExtViewHost` (`visible`/`bare`/`onCrash`/`onRecovered`), `view.setVisible` RPC — all feature 019.

**Storage**: none — selection stays session-only React state.

**Testing**: `bun test ./tests` — tab model unchanged (existing tests stand); add a small pure helper test if selection→accordion-value mapping needs logic.

**Target Platform**: Electrobun desktop (Linux primary dev target).

**Performance Goals**: transition ≤ ~300 ms, no jank; park/restore on collapse/expand.

**Constraints**: constitution §II (native only via typed RPC — unchanged), §IV (shadcn/ui + Tailwind v4 — the accordion is vendored as a `components/ui` wrapper, not a new component library), §VI (the ONE new dependency justified above).

**Scale/Scope**: small — 1 new ui primitive file, WorkspaceTabs rewrite (accordion), TabBar deletion, CSS keyframes, hook rename.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Local-first inference | ✅ pass | untouched |
| II. Electrobun process boundaries | ✅ pass | no new RPC; `view.setVisible` parking reused |
| III. Strict TypeScript & typed FFI | ✅ pass | typed Radix wrappers; no `any` |
| IV. Component standardization | ✅ pass | `@radix-ui/react-accordion` wrapped as shadcn `components/ui/accordion.tsx` (mirrors `alert-dialog.tsx` convention); Tailwind v4 keyframes in index.css |
| V. Vite build pipeline | ✅ pass | renderer-only change |
| VI. Minimal dependencies | ✅ pass w/ justification | `@radix-ui/react-accordion` — FR-007 `forceMount` + FR-009 keyboard nav + ARIA cannot be met by the existing radix deps; matches the established primitive layer |

## Project Structure

### Documentation (this feature)

```text
specs/020-tabs-accordion-ux/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (accordion.md)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
src/renderer/src/
├── components/ui/accordion.tsx             # NEW — shadcn wrapper (Accordion/Item/Trigger/Content + keyframe classes)
├── index.css                              # + accordionDown/Up keyframes (Radix CSS-var pattern) or grid-rows transition utilities; motion-reduce override
├── features/chat/ChatPage.tsx             # prop name updates (useWorkspaceItems, <WorkspaceAccordion>)
└── features/workspace/
    ├── WorkspaceAccordion.tsx             # NEW NAME (was WorkspaceTabs.tsx) — Accordion.Root type="single" collapsible=false, items render headers (tooltip/crash dot/×) + content
    ├── use-workspace-items.ts             # RENAMED (was use-workspace-tabs.ts) — same scan/reconcile logic, `selectedId`→accordion `value`
    └── tab-model.ts                       # unchanged — deriveTabs/reconcile stay the data model
    └── TabBar.tsx                         # DELETED — triggers render inline per AccordionItem
```

**Structure Decision**: presentation-layer rewrite inside `features/workspace/`; data model, hook logic, `ExtViewHost`, and all bun-side code untouched. The 019 diagnostic `console.log`s in `handlers.ts`/`ExtViewHost.tsx` get stripped during implementation (they were temporary).

## Complexity Tracking

> No constitution violations — section empty.
