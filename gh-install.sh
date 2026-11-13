#!/usr/bin/env bash
# gh-install.sh [tag] — download the packaged canary zip from a GitHub
# release and install it under ~/.local:
#   ~/.local/bin/causerie                      launcher
#   ~/.local/Resources/                        app bundle (metadata + tar.zst)
#   ~/.local/share/applications/causerie.desktop
#
# The launcher resolves Resources/ two levels up from its real path, so the
# binary and Resources/ must land at matching depths — a bare copy without
# Resources/ (or a symlink target) will not start.
set -euo pipefail

repo="marcionicolau/causerie"
asset="causerie-canary-linux-x64.zip"

tag="${1:-}"
if [ -z "$tag" ]; then
  # latest real release (skip the rolling `feed` release)
  tag=$(gh release list -R "$repo" --limit 20 --json tagName \
        --jq '[.[] | select(.tagName != "feed")][0].tagName')
  [ -n "$tag" ] || { echo "no release found" >&2; exit 1; }
fi
echo "installing $tag"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

gh release download "$tag" -R "$repo" -p "$asset" -D "$tmp" --clobber
unzip -q "$tmp/$asset" -d "$tmp/app"

app="$tmp/app/Causerie-canary"
install -Dm755 "$app/bin/launcher" ~/.local/bin/causerie
install -dm755 ~/.local/Resources
install -m644 "$app"/Resources/* ~/.local/Resources/
install -Dm644 "$app/Causerie-canary.desktop" \
  ~/.local/share/applications/causerie.desktop

echo "installed: $HOME/.local/bin/causerie"
