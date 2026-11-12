# Auto-Update

Local-first exception: the update feed is the **only** network surface
this feature uses (FR-010). It is documented here and can be fully
disabled.

## How it works

Packaged builds (`canary`/`stable` env) carry a feed URL baked into
`Resources/version.json` from `release.baseUrl` in
`electrobun.config.ts`. On launch — and on demand via Settings →
"Check for updates" — the app fetches a channel-scoped manifest:

```
{baseUrl}/{channel}-{os}-{arch}-update-v2.json
{baseUrl}/{channel}-{os}-{arch}-notes.md       # changelog sidecar
```

- **Check** is fire-and-forget after first paint; failures are silent
  (the app behaves exactly as a build without the feature — FR-007).
- **Download** uses Electrobun's built-in updater: background fetch with
  progress, `tarSha256` verification, staged by a native helper.
  Corrupted or partial artifacts are refused with `UPDATE_INVALID` —
  nothing partial is ever applied (FR-004, FR-008).
- **Apply** requires an explicit "Restart to update" action — never a
  mid-session restart (FR-005).
- **Channel selection**: Settings picks `stable` or `canary`. Same
  channel updates apply in place; a different channel offers the
  matching packaged installer to download — channel dirs are
  side-by-side under `~/.local/share/<identifier>/<channel>/`, user data
  untouched (FR-006, FR-009).
- `dev` builds never check (the devkit disables updates by design).

## Disabling

- Settings → Updates → uncheck "Automatic checks", or
- `AI_DESKTOP_APP_UPDATE=off` environment variable — forces the service
  off regardless of the stored preference.

When disabled the app performs **zero** update requests.

## Feed layout & publishing

`packaging.yml` publishes on every semver tag (`vX.Y.Z` → stable,
`vX.Y.Z-rc.N` → canary):

- artifacts emitted by `electrobun build` into `artifacts/` — the
  per-platform `*-update-v2.json` manifest, full `.tar.zst` bundle, and
  optional delta patches — are uploaded to the rolling `feed` GitHub
  Release with `--clobber`,
- `{prefix}-notes.md` sidecars are generated from `git log` between the
  channel's previous tag and HEAD.

Default production baseUrl:
`https://github.com/marcionicolau/causerie/releases/download/feed`
— requires the repo (or the feed host) to serve assets unauthenticated.
While the repo is private, point `UPDATE_FEED_BASE_URL` at any static
HTTPS host; `http://localhost` is allowed for local testing
(see `specs/013-auto-update/quickstart.md`).

## Error codes

| Code | Meaning |
|---|---|
| `UPDATE_INVALID` | Artifact/manifest failed integrity validation — refused, app unchanged |
| `UPDATE_FAILED` | Transport or staging failure |
| `UPDATE_DISABLED` | Updates off (setting, env, or dev build) |
