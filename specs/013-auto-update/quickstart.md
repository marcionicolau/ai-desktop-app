# Quickstart: Auto-Update (013)

Verify the feature end-to-end locally using a loopback feed — the
devkit permits `http://localhost` baseUrls for exactly this purpose.

## 1. Build a "current" package

```bash
bun install
bun run build:native          # scripts/build-native.sh
UPDATE_FEED_BASE_URL=http://localhost:8787 bun run build
# produces build/canary-linux-x64/ + artifacts/canary-linux-x64-update-v2.json
```

## 2. Serve the feed

```bash
# the build emits artifacts/ — serve it plus a notes sidecar
echo "- New features" > build/artifacts/canary-linux-x64-notes.md
(cd build/artifacts && bun x serve . -l 8787)   # or python3 -m http.server
```

## 3. Simulate "update available"

Bump the version, rebuild, and let the newer manifest replace the old:

```bash
git tag v0.2.0-rc.1   # or commit so version.ts computes a newer version
bun run build         # artifacts/ now contains the newer manifest+bundle
```

Re-serve `artifacts/` — the client only needs the files, not a second server.

## 4. Exercise the app

1. Install/launch the **older** package (`build/canary-linux-x64/`).
2. On launch (or Settings → "Check for updates") the banner shows the
   new version + notes.
3. "Download" → progress bar → "Restart to update" → the app relaunches
   on the new version (`resources/version.json` reports the new hash).

## 5. Negative checks

- **Corrupt artifact**: flip a byte inside the `.tar.zst` asset →
  download is refused with `UPDATE_INVALID`; app keeps running.
- **Offline**: stop the feed server → launch check fails silently;
  every feature works unchanged.
- **Channel switch**: select `stable` in Settings → canary build offers
  the guided install (download-to-Downloads), never an in-place apply.

## Gates

```bash
bun run typecheck && bun run lint && bun test
```
