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
| Success / error | Sonner toast, bottom-right, offset above the composer, at most 3 stacked | errors persist and carry a recovery action where one exists (FR-002) |
| Empty | `Empty` with reason + primary action | every list/panel (FR-003) |
| Destructive | `confirm()` naming `itemName` and `consequence` | FR-004 |
| Unavailable | disabled control + tooltip stating reason | FR-019 |

Toasts are announced through Sonner's polite live region. Persistent in-surface errors use `Alert` (`role="alert"`). Reply completion/stop is announced by a polite live region in `MessageList` (FR-022).
