# Contract: Action Registry & Shortcuts

`lib/actions.ts` exports `ACTIONS: ActionEntry[]` (see data-model.md) and `shortcutLabel(id)`.

## Initial entries

| Group | Entry | Shortcut |
|---|---|---|
| action | New chat | `Ctrl/Cmd+N` |
| action | Open command palette | `Ctrl/Cmd+K` |
| action | Toggle sidebar (existing) | `Ctrl/Cmd+B` |
| action | Switch model | `Ctrl/Cmd+M` |
| action | Toggle theme | — |
| action | Toggle density | — |
| action | Open settings | `Ctrl/Cmd+,` |
| navigate | each workspace surface (chat, models, roles, personas, scripts, settings, extensions) | — |
| conversation | one per conversation (title filter; ≥ 3 chars uses `search.query`) | — |

Shortcut keys are defaults to be confirmed against OS/webview conflicts in S3. Palette rows render the shortcut with `Kbd`; the same table feeds a shortcuts list in settings. Unavailable actions (e.g. "Switch model" while generating) appear disabled with their reason.

Behavior: opening ≤ 100 ms; arrow-key navigation, Enter to run, Esc to close; focus returns to the previously focused element.
