# Research: Unified Component Layer & UX Refresh

## R1: Vendoring mechanism

**Decision**: hand-vendor shadcn/ui + ai-elements recipe sources into `components/ui/` and `components/ai/` respectively, matching the project's existing wrapper conventions (`React.forwardRef` + `cn`, as in `alert-dialog.tsx`).

**Rationale**: no `components.json` exists — the project already vendors manually (6 ui files). The shadcn CLI could scaffold `components.json`, but its config writes would impose directory/style assumptions; manual vendoring keeps §VI control over exactly which recipe deps land.

**Alternatives**: `npx shadcn init` + `shadcn add` — rejected: introduces registry config drift; we only need ~15 components and can audit each.

## R2: Theme system mechanics

**Decision**: Tailwind v4 pattern — `@custom-variant dark` + two token sets in `index.css` (`:root` = light, `.dark` = dark, refining existing oklch dark tokens). `Settings.themeMode` (`"system"|"light"|"dark"`, default `"system"`) persists via existing `settings.get/set`; renderer resolves `system → matchMedia('(prefers-color-scheme: dark)')` + a change listener, toggles `.dark` on the root element, and pushes `{mode, vars}` to extension views.

**Theme push path**: `pushTheme({mode, vars})` already exists (views.ts:149) and is seeded at `view.open`; extend so `settings.set` touching `themeMode` broadcasts the resolved theme to all open views (handler-side, no new RPC).

**Alternatives**: class-only persistence in localStorage — rejected: spec requires persistence through settings (single source, survives data-dir semantics). Media-query-only `.dark` — rejected: can't express manual override.

## R3: App shell restructure (sidebar-05)

**Decision**: `main.tsx` still mounts `ChatPage`; ChatPage's `<main>` becomes `<SidebarProvider><AppSidebar/><SidebarInset>…</SidebarInset></SidebarProvider>`. `Sidebar.tsx` is rebuilt as `AppSidebar`: search form on top, collapsible nav groups — **Chats** (conversation list + per-item rename/delete actions via dropdown), **Extensions** (enabled packs → focus their accordion item; "Manage extensions…" opens the existing ExtensionsPanel), sidebar footer entries (Settings, Model Library, Personas, Roles). `SidebarInset` hosts the slim header (`SidebarTrigger` + context label + remaining chrome) and the workspace accordion.

**Extensions entry**: nav group, not a header toggle — enabled packs become nav items that `select()`/`focusView()` the accordion; management stays in ExtensionsPanel behind a nav item (resolves the tension noted in spec review).

**Alternatives**: keep puzzle-toggle drawer inside Chat item — rejected: user chose sidebar organization; drawer-sections-in-chat-item was already awkward.

## R4: Audit enforcement test

**Decision**: `tests/ui-audit.test.ts` — file-scan test asserting (a) zero `@radix-ui/*` imports under `src/renderer/src/` outside `components/ui/`, (b) zero raw color literals (`#hex`, `oklch(`, `rgb(`) outside `index.css`/token files, (c) every `components/ui/*.tsx` has a wrapper export. Follows existing headless-test style.

**Rationale**: SC-001 must be machine-checkable; a test beats documentation for keeping the rule enforced going forward.

## R5: Message scroller

**Decision**: implement scroll-anchoring inside `MessageList` (stick to bottom while streaming unless the user scrolls up) — pattern from ai-elements Chat, not the `@shadcn/react` package.

**Rationale**: `@shadcn/react` Message Scroller is a packaged component (dependency); our `MessageList` already owns scroll logic (`scrollToId`, `scrollIntoView`) — extending it is smaller than a new package dep.

## R6: Model Selector placement

**Decision**: compact `ai/model-selector` in the `SidebarInset` header — two-menu pattern: active model menu + role/tag menu (fusion shows planner/executor pickers). Full browsing stays in `ModelLibrary` (opened from the selector's "Manage…" item and sidebar footer).

**Rationale**: the element maps exactly onto planner+executor tag picking; header placement restores a compact selector removed in 018 without resurrecting the old ModelPicker (this one opens the library rather than reimplementing it).

## R7: Context (token usage) element

**Decision**: `ai/context` chip in the prompt-input footer — shows last-prompt token share of the active model's context size. Data: `message.stats.promptTokens` (exists, feature 016) + model context size (model list/meta already fetched for the library). Hidden when stats/model meta unavailable.

**Rationale**: data exists; the element is a read-only indicator — no new RPC needed.

## R8: Confirmation element

**Decision**: `ToolCallCard` IS the confirmation surface — restyle to the Confirmation recipe (inline approve/deny prompt with clear affordances, `allowSession` retained). No new component file; the card upgrades in place per FR-010 parity.

## R9: Deferred elements

Sources, Inline Citation, Terminal, Test Results — out of scope (spec A7); no backing data. Hover-card dep deferred with Inline Citation (NOT installed in v1).

## R10: Palette + type scale

**Decision**: light palette = shadcn neutral defaults (oklch); dark palette = refinement of existing app tokens (background `oklch(0.13…)` family, keep the accent hue). Type scale: 8 steps (`text-xs` … `text-4xl` bounds), font stack `system-ui` + `ui-monospace` for code (A3 offline-safe).

## R11: Code block

**Decision**: keep the existing `components/ai/code-block.tsx`, token-align it + adopt the registry Code Block's affordances (language label, copy). NO syntax-highlighter dependency.

**Rationale**: registry code-block pulls `shiki` (~1MB) — violates §VI for marginal gain; current block already highlights via existing machinery.

## R12: Missing-primitive table (what each new dep unlocks)

| Dep | Needed by |
|---|---|
| `react-collapsible` | sidebar-05 NavMain, TraceCollapsible |
| `react-tooltip` | `ui/sidebar` icon-rail tooltips, header hints |
| `react-separator` | sidebar-05 header separator |
| `react-dropdown-menu` | Model Selector menus, conversation item actions |
| `react-progress` | Context token-usage bar |
| `react-sheet` | `ui/sidebar` offcanvas (narrow windows) |
| `react-popover` | Suggestion/snippet picker, Model Selector |
