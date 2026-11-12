# Data Model: Unified Component Layer & UX Refresh

Mostly presentation — one new persisted setting, one derived client-side entity set.

## Settings (persisted — `settings.get/set` RPC, `src/shared/types.ts`)

```ts
interface Settings {
  // ...existing (generation, outputPanel, snapshot, tools, personas, snippets)
  themeMode?: "system" | "light" | "dark";   // default "system"
}
```

- Read live like `outputPanel` (feature 016 pattern).
- `settings.set` with `themeMode` → persisted + triggers resolved-theme broadcast to open views (R2).

## ResolvedTheme (derived, renderer + pushed to views)

```ts
type ResolvedTheme = {
  mode: "light" | "dark";                  // themeMode==="system" ? matchMedia : themeMode
  vars: Record<string, string>;            // active token set for view CSS
};
```

- Renderer applies `.dark` class when `mode==="dark"`; pushes `{mode, vars}` via existing `view` theme path.
- Views receive it through existing `pushTheme` (views.ts:149) — payload shape unchanged, now populated with real vars.

## Sidebar nav model (client-only, derived)

```ts
type NavGroup = {
  label: string;                            // "Chats" | "Extensions" | "Tools"
  collapsible: true;                        // sidebar-05 submenu groups
  items: NavItem[];
};
type NavItem = {
  id: string; label: string; icon?: Component;
  active?: boolean;                         // active conversation / expanded accordion item
  onSelect: () => void;
  actions?: { label: string; onSelect: () => void }[];  // rename/delete submenu items
};
```

- Chats group ← `state.conversations` + search filter (existing Sidebar logic).
- Extensions group ← enabled packs (same `extension.scan` feed as `useWorkspaceItems`) → `select`/`focusView` + "Manage extensions…".
- Footer entries ← existing panel toggles (settings/library/personas/roles).

## Token set (`index.css` — no TS entity)

- Two palettes under `:root` (light) / `.dark` (dark): background, foreground, card, popover, primary, secondary, muted, accent, destructive, border, input, ring, sidebar-* family.
- Type scale + radius tokens per R10.

## Audit rules (enforced by `tests/ui-audit.test.ts`)

1. `src/renderer/src/**` outside `components/ui/` MUST NOT import `@radix-ui/*`.
2. Raw color literals (`#hex`, `oklch(`, `rgb(`, `hsl(`) forbidden outside `index.css`.
3. Each ai-elements recipe composes only `components/ui/*` + `components/ai/*` + `lucide-react`.
