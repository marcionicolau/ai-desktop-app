# Data Model: Startup Model Selection

No new persisted entities — the feature reuses `settings.activeModelPath`
and the existing `ModelStatus` union.

## Renderer state (session-only)

| Field | Type | Notes |
|-------|------|-------|
| `startupPromptDismissed` | `boolean` | true once the user closes the auto-opened library without loading a model; never persisted |

## Existing entities reused

- **`ModelStatus`** = `"unloaded" | "loading" | "ready" | "error"` —
  `unloaded` = no configured default; `error` at bootstrap = configured
  default unusable (FR-007). Both terminal non-ready states trigger the
  prompt; `loading` suppresses it (FR-006).
- **`settings.activeModelPath`** — selecting a model writes the default
  exactly as today's manual flow does (`model.load` + settings save via
  `role.bind`/activePath sync); no new write path.

## Transitions

```text
startup → model.status reconcile
  "ready"               → no prompt (FR-003)
  "loading"             → wait; terminal status decides (FR-006)
  "unloaded" | "error"  → auto-open ModelLibrary (FR-001/FR-007)
    user loads model    → modelStatus "ready", library closes, default saved (FR-002)
    user closes library → startupPromptDismissed = true; banner state remains (FR-004)
```
