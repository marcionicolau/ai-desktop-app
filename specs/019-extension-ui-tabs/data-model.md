# Data Model: Extension UI Tabs

Renderer-side model — nothing new persists. Pack enablement remains the persistence boundary (`extensions.json`).

## WorkspaceTab

```ts
type WorkspaceTab =
  | { kind: "chat"; id: "chat"; title: "Chat" }
  | {
      kind: "ext";
      id: string;        // `${packId}:${viewId}` — stable across refreshes
      packId: string;
      viewId: string;
      title: string;     // decl.title ?? viewId ?? packId
      packName: string;  // manifest.name — tooltip identity (FR-009)
    };
```

- **Identity**: `id` for `ext` tabs is `packId:viewId` — deterministic, so lifecycle transitions diff cleanly (an enabled pack's tab id is identical before/after refresh).
- **Ordering**: `chat` is always index 0; `ext` tabs follow `extension.scan` order then manifest declaration order (A4).
- **Selection**: `selectedTabId: string` session-only; default `"chat"`; restored-on-startup stays `"chat"`.

## Derivation

```ts
deriveTabs(packs: InstalledPackView[]): WorkspaceTab[]
```

- Input: packs from `extension.scan` (already carries `manifest.contributions.views`).
- Keep: packs with `state === "enabled"`, each `view.slot === "tab"` → one `ext` tab.
- Always prepend the `chat` tab.

## Lifecycle transitions (pure — headless-testable)

```ts
reconcile(tabs: WorkspaceTab[], selectedId: string, changed: InstalledPackView):
  { tabs: WorkspaceTab[]; selectedId: string }
```

| Transition | Effect |
|---|---|
| pack → `enabled` (has tab views) | tabs added; `selectedId` → first new tab (FR-005 auto-select) |
| pack → `disabled` / removed | its tabs removed; if `selectedId` vanished → `"chat"` (FR-010) |
| startup restore | enabled tabs exist; `selectedId` stays `"chat"` (FR-006, Q1) |
| unrelated `extension.changed` | tabs recomputed; `selectedId` preserved if still valid |

## View session binding

- `WorkspaceTab.ext` ↔ one `ViewSession` (`packId:viewId`), enforced bun-side by `ViewManager.open` replace semantics (D4).
- `selected` → `ExtViewHost visible=true` → real bounds via ResizeObserver.
- `hidden` → `visible=false` → `view.setVisible(false)` parks native view offscreen.

## Shared type additions

```ts
// src/shared/types.ts
export interface WorkspaceTabView { /* WorkspaceTab "ext" variant */ }

// rpc-contract.ts requests
"view.setVisible": {
  params: { sessionId: string; visible: boolean };
  response: {};
};
```
