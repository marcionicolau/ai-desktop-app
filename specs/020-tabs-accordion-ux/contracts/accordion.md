# Contract: Workspace Accordion Components

Presentation contract — no RPC/schema changes (019's `view.setVisible`/`view.open rect` stay authoritative).

## `components/ui/accordion.tsx` (new — shadcn wrapper)

Exports, mirroring `alert-dialog.tsx` conventions (`forwardRef`, `cn`, `data-*` styling):

| Export | Wraps | Contract |
|---|---|---|
| `Accordion` | `AccordionPrimitive.Root` | `type="single"`, `collapsible={false}`, `value`, `onValueChange` |
| `AccordionItem` | `AccordionPrimitive.Item` | `value` (item id), border-b chrome |
| `AccordionTrigger` | `AccordionPrimitive.Trigger` | header row: `data-state` selected styling, `title` tooltip, children = title + affordances |
| `AccordionContent` | `AccordionPrimitive.Content` | `forceMount`, overflow-hidden, animated content size, `data-state` keyed classes |

CSS additions in `index.css` (Tailwind v4): `accordionDown`/`accordionUp` keyframes over `height: 0 ↔ var(--radix-accordion-content-height)` (~250–300 ms, `ease-out`), exposed as `animate-accordion-down/up`; `motion-reduce` disables them (or grid-rows fallback classes if R3's fallback is taken).

## `features/workspace/WorkspaceAccordion.tsx` (renamed from WorkspaceTabs.tsx)

```ts
interface Props {
  tabs: WorkspaceTab[];          // unchanged model type (name kept for 019 parity)
  selectedId: string;
  select: (id: string) => void;
  focusView: (packId: string, viewId: string) => void;
  chat: ReactNode;               // chat item content
  focusRunId: string | null;
  onRunStarted: (runId: string) => void;
  onOpenPanelView: (packId: string, viewId: string) => void;
  onCloseTab: (packId: string) => void; // → extension.disable
}
```

Item rendering contract:

- `chat` → `AccordionItem value="chat"` — trigger = "Chat", NO × affordance; content = `chat` node.
- `ext` → `AccordionItem value="${packId}:${viewId}"` — trigger = view title + `title — packName` tooltip + crash `●` + ×; content = `ExtViewHost bare visible={expanded}`.
- `pack` → `AccordionItem value=packId` — trigger = pack name + tooltip + ×; content = `WorkspaceBrowser` + `RunView` in a scrollable region.
- All `AccordionContent` use `forceMount` (FR-007). Crash badge set lives in `WorkspaceAccordion` (unchanged logic, prune-on-vanish included).

## `features/workspace/use-workspace-items.ts` (renamed)

Same signature as `useWorkspaceTabs`: `{ tabs, selectedId, select, focusView }` — exported as `useWorkspaceItems`. `tab-model.ts` and its tests are untouched.

## Deleted

- `features/workspace/TabBar.tsx` — its trigger row is absorbed by `AccordionItem`/`AccordionTrigger` per item.
