# Contract: Release Feed (013)

The feed is a static file set at `release.baseUrl`. The packaging
workflow owns publishing; the client only reads.

## URL layout

```
{baseUrl}/{channel}-{os}-{arch}-update-v2.json   # Electrobun manifest
{baseUrl}/{channel}-{os}-{arch}-notes.md         # changelog sidecar (this feature)
{baseUrl}/{artifact.file}                        # full .tar.zst bundle
{baseUrl}/{patch files}                          # delta patches (optional)
```

`{channel}` ∈ `stable | canary`; `{os}-{arch}` = `linux-x64`,
`darwin-arm64`, `darwin-x64`, `win-x64`.

`baseUrl` for production =
`https://github.com/<owner>/<repo>/releases/download/feed` — a single
rolling GitHub Release (tag `feed`, marked prerelease) whose assets are
clobbered on every tag build. Any static HTTPS host works; loopback
`http://localhost[:port]` is allowed for tests (devkit enforces
HTTPS-or-loopback itself).

## Manifest (`update-v2.json`)

Produced by `electrobun build --env=<channel>` when
`release.baseUrl` is configured. Validated by the devkit's
`validateUpdateManifest` — required fields:

```jsonc
{
  "schemaVersion": 1,
  "identifier": "dev.local.ai-desktop-app",
  "channel": "stable",              // must equal manifest filename channel
  "version": "1.4.2",
  "hash": "223863joo14uy",          // bundle content hash — the real identity
  "platform": "linux",
  "arch": "x64",
  "artifact": {
    "file": "<platform-prefix>-<hash>.tar.zst",
    "tarSha256": "<64 hex>",        // REQUIRED — integrity boundary (FR-004)
    "tarSize": 12345678
  }
}
```

## Notes sidecar (`{prefix}-notes.md`)

Generated in the release job from `git log <prev-channel-tag>..<tag>
--pretty=format:'- %s'`. Fetched only when a manifest advertises a newer
build; absent or unreadable → changelog shows "No notes published"
(non-fatal).

## Publisher contract (packaging workflow)

For each tag build (`vX.Y.Z` → stable, `vX.Y.Z-rc.N` → canary):

1. Build emits `artifacts/` containing manifest + bundle (+ patches).
2. `gh release upload feed <artifacts> --clobber` adds/overwrites that
   channel+platform's manifest, artifact, patches, and notes file.
3. Assets are **never renamed** — the updater constructs URLs from the
   manifest's `artifact.file`.

Failure semantics: a half-published feed (manifest updated, artifact
missing) is self-healing — clients fail integrity/refusal checks with
`UPDATE_INVALID` and stay on the current version.
