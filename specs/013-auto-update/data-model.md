# Data Model: Application Auto-Update (013)

## Persisted state (settings store)

Two fields added to the app settings record (same versioned store
used by `settings.get`/`settings.set`; bump handled by the existing
store migration machinery):

| Field | Type | Default | Notes |
|---|---|---|---|
| `updates.enabled` | `boolean` | `true` | Master switch (FR-010). `AI_DESKTOP_APP_UPDATE=off` overrides to `false`. |
| `updates.channel` | `"stable" \| "canary"` | installed channel | Preferred feed channel (FR-006). Written by Settings UI. |

The **installed** channel is read-only and comes from
`Updater.getLocalInfo().channel` (baked into `version.json` by
`electrobun build --env=...`).

## Runtime entities (not persisted)

### ReleaseDescriptor

Mirrors the spec's release descriptor; derived from the Electrobun
update manifest + sidecar notes file.

```ts
interface ReleaseDescriptor {
  version: string;          // manifest.version (semver string)
  channel: "stable" | "canary";
  hash: string;             // manifest.hash — devkit identity, not semver
  artifactUrl: string;      // buildUpdateArtifactUrl(baseUrl, artifact.file)
  tarSha256: string;        // artifact.tarSha256 — verified by native helper
  tarSize?: number;         // artifact.tarSize — used for progress denominator
  changelog: string;        // sidecar {prefix}-notes.md, markdown (may be "")
  publishedAt?: string;     // parsed from the notes sidecar's `date: YYYY-MM-DD`
                            // first line (see contracts/feed.md); undefined if absent
}
```

### UpdateView — the single RPC-visible state (spec "Update state")

```ts
interface UpdateView {
  status:
    | "idle"        // no check yet, or silent failure
    | "checking"
    | "available"   // newer release on selected channel
    | "downloading" // includes progress
    | "ready"       // verified + staged; awaits restart
    | "error";      // named failure (see RpcErrorCode additions)
  current: { version: string; channel: "stable" | "canary" | "dev" };
  preferredChannel: "stable" | "canary";
  release?: ReleaseDescriptor;
  channelSwitch?: boolean;  // release exists on a non-installed channel
  progress?: { bytesDownloaded: number; totalBytes: number; percent: number };
  error?: { code: RpcErrorCode; message: string };
  lastCheckedAt?: number;   // epoch ms; for "last checked" display
}
```

### Status mapping (devkit → UpdateView.status)

| Devkit `UpdateStatusType` | UpdateView.status |
|---|---|
| `checking`, `check-complete` | `checking` |
| `update-available` | `available` |
| `downloading`, `download-starting`, `fetching-patch`, `patch-*`, `downloading-patch`, `applying-patch`, `downloading-full-bundle`, `download-progress`, `decompressing`, `checking-local-tar`, `extracting-version` | `downloading` |
| `download-complete`, `local-tar-found` | `ready` |
| `applying`, `extracting`, `replacing-app`, `launching-new-version`, `complete` | `ready` (app is quitting) |
| `no-update`, `idle` | `idle` |
| `error`, `patch-failed`, `local-tar-missing` | `error` (artifact failures → `UPDATE_INVALID`; transport → `UPDATE_FAILED`) |

## Validation rules

- `preferredChannel` ∈ {stable, canary}; `dev` can never be *selected*
  (dev builds surface "updates disabled" instead).
- Downgrade guard: manifest `version` must semver-compare `>=` the
  installed `version`; equal-or-lower + different hash is still offered
  (rebuild), strictly-lower version is ignored.
- `ReleaseDescriptor.artifactUrl` must be `https:` (loopback `http`
  allowed for tests) — enforced by `prepareNativeUpdate`.
- Corrupt/partial artifact → `UPDATE_INVALID` error; prepared record is
  never written, so nothing partial can apply (FR-008).
