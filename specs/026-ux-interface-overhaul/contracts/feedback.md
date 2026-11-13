# Contract: Feedback Patterns

`lib/notify.ts` is the only way to show transient feedback.

```ts
notify.success(title, opts?)      // auto-dismiss 4 s
notify.error(title, opts?)        // persists; opts.action = { label, run } for recovery
notify.progress(id, title)        // returns { update(percent), done(title), fail(title, action?) }
confirm({ title, itemName, consequence, confirmLabel }): Promise<boolean>   // wraps AlertDialog
```

| State | Component | Rule |
|---|---|---|
| Busy (> 200 ms) | `Spinner` / `Progress` inside the triggering control; control `disabled` + `aria-busy` | visible within 200 ms (FR-001) |
| Success / error | Sonner toast, bottom-right, announced via live region | errors carry a recovery action (FR-002) |
| Empty | `Empty` with reason + primary action | every list/panel (FR-003) |
| Destructive | `confirm()` naming `itemName` and `consequence` | FR-004 |
| Unavailable | disabled control + tooltip stating reason | FR-019 |

Toasts are `role="status"` (success/info) or `role="alert"` (error); streaming-reply completion announces through the same live region (FR-022).
