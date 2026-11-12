# Contract: Startup Prompt Trigger

UI-level contract; **no new RPC endpoints** — reuses `model.status` mount
reconciliation + `model.progress` events.

## Trigger

The model-selection surface (`ModelLibrary` drawer) opens automatically
when ALL hold:

1. startup status reconciliation has completed, AND
2. `modelStatus ∈ { "unloaded", "error" }`, AND
3. `startupPromptDismissed === false`

`loading` never triggers (in-flight configured default, FR-006).

## Resolution

| Outcome | Effect |
|---------|--------|
| Model loaded via library | `modelStatus → "ready"`; `activeModelPath` persisted by the existing load path; prompt resolves permanently |
| Download completes | same as above (a download counts as selection, spec assumption) |
| Library closed, no load | `startupPromptDismissed = true`; existing "no model loaded" banner remains; manual picker still 1 click away |

## Non-goals

- No new RPC method, event, or settings key.
- No re-prompt within the session; next launch re-evaluates from status.
