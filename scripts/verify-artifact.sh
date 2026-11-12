#!/usr/bin/env bash
# verify-artifact.sh <artifact-root> — structural check of a packaged
# electrobun artifact (research R6): binary present+executable, required
# native lib set staged, renderer bundle present. Per-OS lib extension
# is inferred from the artifact's native/<os>-<arch>/ directory.
set -euo pipefail

root="${1:?usage: verify-artifact.sh <artifact-dir e.g. build/canary-linux-x64>}"

fail() { echo "verify-artifact: FAIL — $1" >&2; exit 1; }

# locate the inner app dir (<AppName>-<env>/); env comes from the artifact
# root name (build/<env>-<platform>) so renames of app.name can't break this
env_name=$(basename "$root" | cut -d- -f1)
app_dir=$(find "$root" -mindepth 1 -maxdepth 1 -type d -name "*-${env_name}" | head -1)
[ -n "$app_dir" ] || fail "no *-${env_name} app dir under $root"

# binary present + executable (win: *.exe; unix: bin/ launcher)
if ls "$app_dir"/bin/*.exe >/dev/null 2>&1; then
  :
elif find "$app_dir/bin" -maxdepth 1 -type f -executable | grep -q .; then
  :
else
  fail "no executable binary under $app_dir/bin"
fi

res="$app_dir/Resources/app"
listing=""
if [ ! -d "$res" ]; then
  # canary/stable pack resources into Resources/*.tar.zst instead
  pkg=$(find "$app_dir/Resources" -maxdepth 1 -name "*.tar.zst" | head -1)
  [ -n "$pkg" ] || fail "missing Resources/app and no Resources/*.tar.zst in $app_dir"
  command -v zstd >/dev/null || fail "zstd required to inspect $pkg"
  listing=$(zstd -dc "$pkg" | tar -tf -)
  echo "$listing" | grep -q "views/main/index.html" \
    || fail "missing views/main/index.html (renderer bundle)"
  plat=$(echo "$listing" | grep -o "native/[^/]\+" | head -1 | cut -d/ -f2)
  [ -n "$plat" ] || fail "no native/<platform> entries in $pkg"
else
  [ -f "$res/views/main/index.html" ] || fail "missing views/main/index.html (renderer bundle)"
  plat_dir=$(find "$res/native" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -1)
  [ -n "$plat_dir" ] || fail "no native/<platform> dir under $res/native"
  plat=$(basename "$plat_dir")
fi
case "$plat" in
  linux-*)   ext="so" ;;
  darwin-*)  ext="dylib" ;;
  win-*)     ext="dll" ;;
  *)         fail "unrecognized platform dir: $plat" ;;
esac

if [ -n "$listing" ]; then
  present() { echo "$listing" | grep -q "native/$plat/$1\\..*${ext}"; }
else
  present() { find "$plat_dir" -name "$1.*${ext}" -o -name "$1.${ext}" | grep -q .; }
fi

missing=()
if   present "libllama_shim" || present "llama_shim"; then :; else missing+=("llama_shim"); fi
if   present "libllama"      || present "llama";      then :; else missing+=("llama"); fi
if   present "libggml"       || present "ggml";       then :; else missing+=("ggml"); fi
((${#missing[@]})) && fail "missing native libs in $plat_dir: ${missing[*]}"

echo "verify-artifact: PASS — $plat artifact at $app_dir"
