# Data Model: Workspace Tabs — Accordion UX

Presentation-layer change — the tab model from feature 019 is reused verbatim (spec A4). No new persistence.

## WorkspaceItem (was WorkspaceTab — model unchanged)

```ts
type WorkspaceItem = WorkspaceTab; // src/shared/types.ts — union kept:
  | { kind: "chat"; id: "chat"; title: "Chat" }
  | { kind: "ext";  id: `${packId}:${viewId}`; packId; viewId; title; packName }
  | { kind: "pack"; id: packId; packId; title; packName }   // enabled pack, no tab views
```

- **Identity/order**: `chat` first, then enabled packs in scan→declaration order (019 rules).
- **Derivation/reconcile**: `deriveTabs(packs)` / `reconcile(prev, packs)` in `tab-model.ts` — untouched, tests still authoritative.

## Accordion state mapping

```ts
// Accordion.Root type="single" collapsible={false}
value          = selectedId            // expanded item id
onValueChange  = select(id)            // select() already guards to known ids
```

| UI event | Effect |
|---|---|
| header click / arrow keys | `select(id)` → one item expands, previous collapses (animated) |
| enable pack | `extension.changed` → reconcile → fresh item auto-expands |
| disable/remove / × on header | `extension.disable` → item closes; vanished selection falls back to `"chat"` |
| restart | baseline seeds `value="chat"` — no startup animation steal |

## Item content binding

| Item kind | Content | Keep-alive |
|---|---|---|
| `chat` | MessageList..Composer block | `forceMount` — React state survives collapse |
| `ext`  | `ExtViewHost bare visible={expanded}` | `forceMount` + `view.setVisible` park/unpark |
| `pack` | `WorkspaceBrowser` + `RunView` | `forceMount` — browser state survives collapse |

## Animation state (CSS only)

- `data-state="open"` on content → `accordionDown` keyframes (height `0 → var(--radix-accordion-content-height)`), or grid-rows `0fr→1fr` fallback.
- `data-state="closed"` + still mounted → `accordionUp` reverse; `hidden` applied at exit end.
- `motion-reduce` → animations disabled (FR-005).
