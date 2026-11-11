#!/usr/bin/env bash
# Build llama_shim + llama.cpp deps into native/out/<platform>/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

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
BUILD_DIR="${ROOT}/native/out/${PLATFORM}/build"

cmake -S "${ROOT}/src/native/shim" -B "${BUILD_DIR}" -DCMAKE_BUILD_TYPE=Release
cmake --build "${BUILD_DIR}" -j "$(nproc 2>/dev/null || sysctl -n hw.ncpu)"

bun "${ROOT}/scripts/stage-native.ts" "${BUILD_DIR}" "${ROOT}/native/out/${PLATFORM}"
echo "staged native artifacts -> native/out/${PLATFORM}"
