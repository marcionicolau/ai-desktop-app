# Contract: Update RPC (013)

Extends `src/shared/rpc-contract.ts` (`ChatRpcSchema`). Bun side handles
the requests below; the webview receives one pushed message.

## Error codes (added to `RPC_ERROR_CODES`)

| Code | Raised when |
|---|---|
| `UPDATE_INVALID` | Artifact failed integrity verification (`tarSha256` mismatch), manifest failed validation, or a partial/corrupt stage was detected. Named refusal per FR-004. |
| `UPDATE_FAILED` | Transport/feed failures surfaced non-silently (manual check errors are still reported; launch-check errors degrade to `idle` silently). |
| `UPDATE_DISABLED` | Requests rejected while `updates.enabled === false` or channel is `dev`. |

## Requests handled by `bun`

```ts
"update.check": {
  params: { manual?: boolean };        // manual → errors reported; auto → silent
  response: UpdateView;
}
"update.download": {
  params: Record<string, never>;       // no-op if !updateAvailable
  response: { installerPath?: string }; // set only on the channelSwitch
                                      // path — absolute path of the
                                      // saved installer zip; otherwise
                                      // ack-only, progress via update.status
}
"update.apply": {
  params: Record<string, never>;       // explicit user action only (FR-005)
  response: Record<string, never>;     // ack; app quits into helper apply
}
"update.state": {
  params: Record<string, never>;
  response: UpdateView;                // snapshot for late-mounting UI
}
```

`settings.set` gains `updates?: { enabled?: boolean; channel?: "stable" | "canary" }`;
`settings.get` response gains `updates: { enabled: boolean; channel: "stable" | "canary" }`.

## Message pushed to `webview`

```ts
"update.status": UpdateView            // every devkit status transition + progress
```

`UpdateView` shape: see `data-model.md`. `progress` is present only while
`status === "downloading"`. `channelSwitch === true` means the release
exists on the user's selected channel but differs from the installed
channel — the renderer shows the guided-install flow instead of an
apply button.

## Behavior contract

- `update.check` on `dev` channel or with updates disabled →
  `{ status: "idle", ... }` (or `UPDATE_DISABLED` for `manual: true` —
  renderer decides; launch checks always silent).
- `update.download` when nothing is available → no-op ack.
- `update.apply` when `updateReady === false` → `UPDATE_FAILED`.
- Ordering: `update.status` messages are emitted in devkit order;
  the last `downloading`-phase entry before `ready` carries 100%.
- The service performs **one** check at a time — concurrent
  `update.check` calls share the in-flight promise (devkit semantics).
