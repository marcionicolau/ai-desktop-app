# Build llama_shim + llama.cpp deps into native/out/win-x64/ (MSVC or clang-cl).
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

# FR-004: fail fast naming the missing prerequisite
$missing = @()
if (-not (Get-Command bun   -ErrorAction SilentlyContinue)) { $missing += "bun" }
if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) { $missing += "cmake" }
if (-not (Get-Command cl    -ErrorAction SilentlyContinue) -and
    -not (Get-Command clang-cl -ErrorAction SilentlyContinue)) { $missing += "MSVC/clang-cl toolchain" }
if ($missing.Count -gt 0) { Write-Error "missing prerequisite: $($missing -join ', ')"; exit 1 }

$Platform = "win-x64"
# cmake tree lives outside native/out/ — only the staged libs are packaged
$BuildDir = Join-Path $Root "native/build/$Platform"

cmake -S "$Root/src/native/shim" -B $BuildDir -DCMAKE_BUILD_TYPE=Release
cmake --build $BuildDir --config Release

bun "$Root/scripts/stage-native.ts" "$BuildDir" "$Root/native/out/$Platform"
Write-Host "staged native artifacts -> native/out/$Platform"
