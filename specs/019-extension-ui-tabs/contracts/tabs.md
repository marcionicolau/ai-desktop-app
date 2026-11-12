# Contract: Workspace Tabs & view.setVisible

## UI contract — tab bar

| Element | Behavior |
|---|---|
| Chat tab | Always first, title "Chat", no close control (FR-001/002) |
| Extension tab | Title = declared view title → `viewId` → `packId` fallback (FR-004). Tooltip: `<title> — <pack name>` (FR-009). No close control (A5). |
| Selection | Exactly one selected tab; clicking selects. Selected extension tab's `ExtViewHost` gets `visible=true`; others `false` (FR-007). |
| Overflow | Horizontal scroll; titles truncate with ellipsis (FR-011). |
| Crash | Selected crashed tab shows contained crash state + "Reload view" (FR-008); unselected crashed tabs show a dot/badge on the tab (optional marker). |

## Behavior contract — lifecycle

| Event | Tab effect |
|---|---|
| `extension.changed` pack→enabled | add `tab` view tabs; select first new tab (FR-005) |
| `extension.changed` pack→disabled/removed | drop its tabs; selection → `"chat"` if it vanished (FR-010) |
| app restart | enabled `tab` views restored; selection `"chat"` (FR-006) |
| Browse → Open on `tab`-slot view | select its top tab — no duplicate session (FR-013) |
| Browse → Open on `panel`-slot view | unchanged — opens in drawer host (FR-012) |

## RPC delta — `src/shared/rpc-contract.ts`

```ts
"view.setVisible": {
  params: { sessionId: string; visible: boolean };
  response: {};
};
```

- `visible=false` → `ViewManager` parks the view: `setBounds({x:-10000,y:-10000,width:1,height:1})`.
- `visible=true` → no-op on bounds; the host's ResizeObserver re-pushes real bounds (existing channel). Calling `setVisible` on an unknown session → `NOT_FOUND` PackError (same as `view.setBounds`).
- Idempotent; safe on crashed sessions.

## Existing contracts reused (unchanged)

- `extension.scan` → packs incl. `manifest.contributions.views` (tab discovery)
- `extension.changed` event → lifecycle trigger
- `pack.contributions` → unchanged
- `view.open` / `view.close` / `view.setBounds` / `view.error` → unchanged
- `extensions.json` persistence → enablement restore (FR-006)
