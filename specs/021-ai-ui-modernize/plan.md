# Implementation Plan: Unified Component Layer & UX Refresh

**Branch**: `021-ai-ui-modernize` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

## Summary

Four-story modernization of the renderer: (1) enforce the shadcn-wrapper-only rule — zero direct `@radix-ui/*` imports in feature code; (2) adopt 17 ai-elements recipes for AI surfaces, vendored as `components/ai/*` compositions over new `components/ui/*` primitives (Trace, Badge, Code Block, etc.); (3) light+dark token refresh with persisted `system|light|dark` override propagated to extension BrowserViews via the existing `pushTheme` channel; (4) rebuild the app shell on `ui/sidebar` (sidebar-05 pattern — collapsible submenu groups + search form, provider/inset/trigger, icon-rail collapse).

## Technical Context

**Language/Version**: TypeScript strict, React 19.2, Bun, Electrobun 2.x, Tailwind CSS v4 (`@theme` tokens)

**Primary Dependencies** (new — all §VI-justified, recipes need them; versions ≥7 days old):
- `@radix-ui/react-collapsible` — sidebar-05 NavMain, TraceCollapsible
- `@radix-ui/react-tooltip` — `ui/sidebar` icon-rail tooltips
- `@radix-ui/react-separator` — sidebar-05 header separator
- `@radix-ui/react-dropdown-menu` — Model Selector menus, nav item actions
- `@radix-ui/react-progress` — Context (token-usage) element
- `@radix-ui/react-sheet` — `ui/sidebar` offcanvas variant (narrow windows)
- `@radix-ui/react-popover` — Model Selector / Suggestion pickers
- `@radix-ui/react-hover-card` — DEFERRED (Inline Citation deferred)
- `tw-animate-css` — optional; keep hand-rolled animations if recipes need it
Existing: alert-dialog, scroll-area, slot, cva, lucide-react (accordion vendored then removed when the workspace moved to full-screen panels).

**New `components/ui/*` to vendor** (shadcn sources, project conventions): `sidebar` (largest), `collapsible`, `tooltip`, `sheet`, `separator`, `breadcrumb`, `skeleton`, `badge`, `trace`, `progress`, `dropdown-menu`, `popover`, `kbd`, `card`, `item`?, plus upgraded `code-block`.

**AI layer** (`components/ai/` — existing dir keeps its name): rebuild `message.tsx` (was `ai-message`), `prompt-input.tsx` (Composer core), `trace`-compositions: `chain-of-thought`/`plan`/`reasoning`/`task`/`subagent`/`tool`/`stack-trace`, `confirmation.tsx` (ToolCallCard rebuild), `suggestion.tsx`, `model-selector.tsx`, `checkpoint.tsx` (VariantNav/BranchOverview rebuild), `context.tsx` (token usage — data exists in message `stats`), `file-tree.tsx` (WorkspaceBrowser trees), `message-scroller` behavior inside MessageList.

**Storage**: `settings.themeMode: "system"|"light"|"dark"` (default `"system"`) via existing `settings.get/set` RPC — extends `Settings` type. Sidebar collapse state: localStorage (component convention, no RPC).

**Testing**: `bun test ./tests` headless suite unchanged (renderer-side); audit test — new headless test asserting zero `@radix-ui/*` imports outside `components/ui/` and zero hex/oklch literals outside tokens (SC-001 automation).

**Target Platform**: Electrobun desktop (Linux primary).

**Performance Goals**: no scroll regression on long transcripts; theme switch <1 frame repaint.

**Constraints**: constitution §II (theme sync via existing `view.*`/`pushTheme` only — no new RPC beyond `settings` key), §IV (shadcn + Tailwind — this feature *is* the enforcement), §V (Vite build), §VI (new deps itemized above, all primitive-layer).

**Scale/Scope**: LARGE — ~15 new ui primitives, ~10 ai components, app-shell restructure, theme system, feature-code migration across `features/*`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Local-first inference | ✅ | untouched |
| II. Electrobun process boundaries | ✅ | `settings.themeMode` rides existing `settings.get/set`; theme push rides existing `pushTheme` — zero new IPC surface |
| III. Strict TS & typed FFI | ✅ | vendored components are typed; Settings union extended |
| IV. Component standardization | ✅ **is the feature** | enforcement mechanism = the audit test + convention rule |
| V. Vite build pipeline | ✅ | renderer-only |
| VI. Minimal dependencies | ✅ w/ justification | 7 new `@radix-ui/*` primitives — each required by a vendored recipe (table above); no framework deps |

## Project Structure

### Documentation (this feature)

```text
specs/021-ai-ui-modernize/
├── plan.md · research.md · data-model.md · quickstart.md · tasks.md
├── contracts/
│   ├── theme.md        # token sets, themeMode setting, pushTheme payload
│   └── components.md   # ui/* + ai/* inventory, wrappers, adoption map
└── checklists/requirements.md
```

### Source Code (repository root)

```text
src/renderer/src/
├── index.css                       # light+dark @theme token sets, dark variant, type scale
├── components/
│   ├── ui/                         # + sidebar, collapsible, tooltip, sheet, separator,
│   │                               #   breadcrumb, skeleton, badge, trace, progress,
│   │                               #   dropdown-menu, popover, kbd, card, code-block
│   └── ai/                         # message, prompt-input, chain-of-thought/plan/task/
│                                   #   subagent/tool/stack-trace, confirmation, suggestion,
│                                   #   model-selector, checkpoint, context, file-tree, reasoning
├── features/
│   ├── chat/ChatPage.tsx           # <main> → SidebarProvider+SidebarInset shell
│   ├── chat/Sidebar.tsx            # rebuild → AppSidebar (sidebar-05)
│   ├── chat/MessageList.tsx        # → ai/chat (message-scroller anchoring)
│   ├── chat/Composer.tsx           # → ai/prompt-input
│   ├── chat/ToolCallCard.tsx       # → ai/tool + confirmation + stack-trace
│   ├── chat/VariantNav.tsx, BranchOverview.tsx  # → ai/checkpoint
│   ├── metrics/OutputPanel.tsx     # → ai/context for token usage surface
│   └── extensions/WorkspaceBrowser.tsx  # → ai/file-tree
└── shared/types.ts                 # Settings.themeMode
src/bun/
├── store/json-store.ts             # themeMode persist (settings)
└── rpc/handlers.ts                 # pushTheme sends resolved mode + real vars
tests/
└── ui-audit.test.ts                # NEW: zero-radix-import + token-usage scan
```

**Structure Decision**: AI components live in existing `components/ai/` (project precedent), NOT `components/ai-elements/` — consistent naming, recipe compositions are project code. `components/ui/` remains the only place primitives may be imported.

## Complexity Tracking

> No constitution violations.
