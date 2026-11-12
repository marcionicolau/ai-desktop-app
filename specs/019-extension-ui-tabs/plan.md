# Implementation Plan: Extension UI Tabs

**Branch**: `019-extension-ui-tabs` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/019-extension-ui-tabs/spec.md`

## Summary

Promote extension `tab`-slot views from the extensions drawer into a top-level tab bar: Chat is the fixed first tab, every enabled pack's declared `tab` views become titled peer tabs, with live lifecycle sync (enable→open, disable/remove→close, restart→restore) and per-view crash containment. Implementation is renderer-first: a new `WorkspaceTabs` root above `ChatPage`, tab model derived from `extension.scan` + `extension.changed`, hidden extension sessions kept alive by parking their native `BrowserView` offscreen (no `setVisible` exists in the Electrobun API), and a small `view.setVisible` RPC for semantic clarity.

## Technical Context

**Language/Version**: TypeScript strict, React 19.2, Bun, Electrobun 2.x

**Primary Dependencies**: existing — `ViewManager`/`BrowserView` (feature 017), `ExtensionsStore` + `extension.changed` events, `pack.contributions`, `view.*` RPC. No new packages.

**Storage**: none — tab selection is session-only; pack enablement already persists via `extensions.json` (feature 017).

**Testing**: `bun test ./tests` — tab-model derivation and lifecycle transitions are pure functions (headless-testable); `view.setVisible` covered by ViewManager tests with injected factory.

**Target Platform**: Electrobun desktop (Linux primary dev target; macOS/Windows via same API).

**Project Type**: desktop-app

**Performance Goals**: tab switch instantaneous (no view reload); tab bar updates < 1 s after `extension.changed`.

**Constraints**: constitution — native side only via typed RPC; extension views stay sandboxed `BrowserView`s; no new renderer↔native channels.

**Scale/Scope**: small — 1 new root component + tab model hook, `ExtViewHost` gains a `visible` prop, 1 new RPC, ~4 files touched + tests.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Local-first inference | ✅ pass | no inference surface touched |
| II. Electrobun process boundaries | ✅ pass | view hosting stays `view.*` RPC; tabs are renderer chrome; `view.setVisible` is added to the shared contract, not ad-hoc |
| III. Strict TypeScript & typed FFI | ✅ pass | `WorkspaceTab`/`ViewSlot` typed in `src/shared/types.ts`; no `any` |
| IV. Declarative extension model | ✅ pass | tabs derive from manifest-declared `tab` views; no pack-side code changes |
| V. Test gates | ✅ pass | tab-model + lifecycle pure-function tests before UI wiring |

## Project Structure

### Documentation (this feature)

```text
specs/019-extension-ui-tabs/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (tabs.md)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
src/renderer/src/
├── main.tsx                                # root mounts WorkspaceTabs instead of ChatPage
├── features/workspace/
│   ├── WorkspaceTabs.tsx                   # tab bar + tab content host (new)
│   ├── TabBar.tsx                          # titled tab strip, overflow scroll (new)
│   └── use-workspace-tabs.ts               # tab derivation + lifecycle (new, pure helpers exported)
├── features/extensions/
│   └── ExtViewHost.tsx                     # + visible prop → parks native view when hidden
├── features/chat/ChatPage.tsx              # becomes tab-1 content; ExtViewHost/drawer unchanged for panels
└── lib/rpc.ts                              # unchanged

src/bun/
├── extensions/views.ts                     # ViewManager.setVisible (park/restore bounds)
└── rpc/handlers.ts                         # + view.setVisible handler

src/shared/
├── types.ts                                # + WorkspaceTab, view.setVisible payload
└── rpc-contract.ts                         # + view.setVisible

tests/
├── workspace-tabs.test.ts                  # derivation + lifecycle transitions (pure)
└── extensions/views-visible.test.ts        # park/restore semantics
```

**Structure Decision**: single existing project; new `features/workspace/` renderer module mirrors existing `features/` layout. Bun-side delta is one method + one RPC handler.

## Complexity Tracking

> No constitution violations — section empty.
