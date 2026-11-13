# Contract: Action Registry & Shortcuts

`lib/actions.ts` exports `ACTION_DEFS` (static definitions, used by the settings shortcut list), `buildActions(ctx)` (binds `run()`/`available()` to the live app state, used by the palette and the key handler), `NAV_SURFACES`, `matchesShortcut`, `shortcutLabel` and `actionForKey`. `lib/shortcuts.ts` installs the global key handler.

## Initial entries

| Group | Entry | Shortcut |
|---|---|---|
| action | New chat | `Ctrl/Cmd+N` |
| action | Open command palette | `Ctrl/Cmd+K` |
| action | Toggle sidebar (existing) | `Ctrl/Cmd+B` |
| action | Switch model… (opens the palette on the Models group) | `Ctrl/Cmd+Shift+M` |
| action | Toggle theme | — |
| action | Toggle density | — |
| action | Open settings | `Ctrl/Cmd+,` |
| navigate | each workspace surface (chat, models, roles, personas, scripts, settings, extensions) | — |
| conversation | one per conversation (title filter; ≥ 3 chars uses `search.query`) | — |

Conflict check (T039): plain `Cmd+M` minimizes the window on macOS, so Switch model uses `Shift+M`; `Ctrl/Cmd+N`, `+K` and `+,` have no reserved meaning inside the app webview (Cmd+, is the macOS preferences convention); `Ctrl/Cmd+B` stays with the sidebar component and is display-only in the registry. The key handler ignores events while a confirmation dialog is open. Palette rows render the shortcut with `Kbd`; the same table feeds a shortcuts list in settings. Unavailable actions (e.g. "Switch model" while generating) appear disabled with their reason.

Behavior: opening ≤ 100 ms; arrow-key navigation, Enter to run, Esc to close; focus returns to the previously focused element.
