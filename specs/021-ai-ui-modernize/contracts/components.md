# Contract: Component Layer

## Boundary rule

`components/ui/` = the ONLY place `@radix-ui/*` may be imported. `components/ai/` composes `components/ui/*` + `lucide-react` only. Feature code imports either — never primitives (enforced by `tests/ui-audit.test.ts`).

## `components/ui/` inventory

**Existing (keep)**: `accordion`, `alert-dialog`, `button`, `input`, `scroll-area`, `textarea`

**New — base**:
| File | Wraps | Serves |
|---|---|---|
| `collapsible.tsx` | react-collapsible | sidebar groups, traces |
| `tooltip.tsx` | react-tooltip | icon-rail tooltips |
| `separator.tsx` | react-separator | header separators |
| `sheet.tsx` | react-sheet | sidebar offcanvas |
| `dropdown-menu.tsx` | react-dropdown-menu | model selector, nav actions |
| `popover.tsx` | react-popover | pickers |
| `progress.tsx` | react-progress | context usage |
| `sidebar.tsx` | (composition: slot, tooltip, sheet, separator, input, skeleton, button) | app shell |
| `breadcrumb.tsx` | markup | inset header |
| `skeleton.tsx` | markup | loading states |
| `badge.tsx` | markup+cva | status chips |
| `trace.tsx` | composition (collapsible) | step-trace base |
| `card.tsx` | markup | panels |
| `kbd.tsx` | markup | shortcut hints |
| `code-block` (upgrade `ai/code-block`) | — | language label + copy |

## `components/ai/` inventory (adoption map → spec US2)

| Component | Replaces/wraps | Renders |
|---|---|---|
| `chat.tsx` | MessageList core | scroll-anchored transcript |
| `message.tsx` | `ai-message.tsx` rebuild | turn layout + actions + attachments |
| `prompt-input.tsx` | Composer core | attachments, send/stop, snippets, model shortcut |
| `chain-of-thought.tsx`/`plan.tsx`/`reasoning.tsx` | — (Trace compositions) | fusion plan phases |
| `tool.tsx` + `stack-trace` + `confirmation` | `ToolCallCard` rebuild | tool calls, failures, ask-mode approvals |
| `suggestion.tsx` | snippet chips | one-click prompts (snippets/personas) |
| `model-selector.tsx` | header selector | model + planner/executor tag menus |
| `checkpoint.tsx` | `VariantNav`/`BranchOverview` rebuild | variant return points |
| `context.tsx` | OutputPanel usage chip | token-usage % |
| `task.tsx`/`queue.tsx`/`subagent.tsx` | `RunView` rebuild | pack run steps / run unit |
| `file-tree.tsx` | `WorkspaceBrowser` trees | pack files |

## `AppSidebar` (sidebar-05 contract)

```ts
// features/chat/AppSidebar.tsx (replaces Sidebar.tsx)
interface Props {
  conversations: Conversation[]; activeId: string | null;
  onSelect / onNew / onRename / onDelete / onExport / onImport;  // existing signatures
  packs: { packId: string; name: string }[];                    // enabled packs
  onFocusPack: (packId: string) => void;
  onManageExtensions: () => void;
  onOpenSettings / onOpenLibrary / onOpenPersonas / onOpenRoles: () => void;
}
```

Groups: search form → **Chats** (collapsible; items + rename/delete submenu actions) → **Extensions** (pack items → focus; Manage item) → footer (Settings, Library, Personas, Roles).
