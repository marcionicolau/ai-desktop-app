#!/usr/bin/env bash
# Build llama_shim + llama.cpp deps into native/out/<platform>/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# FR-004: fail fast naming the missing prerequisite (not a cmake/compiler dump)
missing=()
command -v bun   >/dev/null || missing+=("bun")
command -v cmake >/dev/null || missing+=("cmake")
command -v cc    >/dev/null || command -v c++ >/dev/null || command -v gcc >/dev/null || command -v clang >/dev/null || missing+=("c++ toolchain (gcc/clang)")
if ((${#missing[@]})); then
  echo "missing prerequisite: ${missing[*]}" >&2
  exit 1
fi

case "$(uname -s)" in
  Linux)   OS="linux" ;;
  Darwin)  OS="darwin" ;;
  *)       echo "unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)           echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac

PLATFORM="${OS}-${ARCH}"
# cmake tree lives outside native/out/ — only the staged libs are packaged
BUILD_DIR="${ROOT}/native/build/${PLATFORM}"

cmake -S "${ROOT}/src/native/shim" -B "${BUILD_DIR}" -DCMAKE_BUILD_TYPE=Release
cmake --build "${BUILD_DIR}" -j "$(nproc 2>/dev/null || sysctl -n hw.ncpu)"

bun "${ROOT}/scripts/stage-native.ts" "${BUILD_DIR}" "${ROOT}/native/out/${PLATFORM}"
echo "staged native artifacts -> native/out/${PLATFORM}"
