# Contract: Theme System

## Settings extension (`src/shared/types.ts`)

```ts
settings.get → { /* existing */ themeMode?: "system" | "light" | "dark" }  // absent ⇒ "system"
settings.set { themeMode } → persisted; triggers view broadcast (below)
```

No new RPC methods — rides the existing pair.

## Renderer theme resolution

| `themeMode` | Resolved `mode` |
|---|---|
| `"light"` | `"light"` |
| `"dark"` | `"dark"` |
| `"system"` (default) | `matchMedia("(prefers-color-scheme: dark)")` + live change listener |

Applying: `.dark` class toggle on the root element; `data-theme` mirrors resolved mode for attribute selectors.

## View sync (existing channel, now real)

```
handler: settings.set(themeMode) or view.open
  → ViewManager.pushTheme({ mode: resolvedMode, vars: activeTokenVars })
```

- `vars` = the resolved token set as plain CSS var map (`--background`, `--foreground`, …) so extension views can adopt host theming under the capability they already declare (FR-008).
- Live changes broadcast to ALL open sessions without restart (spec AC4).

## Token contract (what `components/ui/*` may reference)

```
--background --foreground --card --card-foreground --popover --popover-foreground
--primary --primary-foreground --secondary --secondary-foreground
--muted --muted-foreground --accent --accent-foreground
--destructive --destructive-foreground --border --input --ring
--sidebar --sidebar-foreground --sidebar-accent --sidebar-accent-foreground
--sidebar-border --sidebar-ring --radius
```

Feature code references semantic utilities (`bg-background`, `text-muted-foreground`…) — never raw values (audit rule 2).
