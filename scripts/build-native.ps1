# Build llama_shim + llama.cpp deps into native/out/win-x64/ (MSVC or clang-cl).
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$Platform = "win-x64"
$BuildDir = Join-Path $Root "native/out/$Platform/build"

cmake -S "$Root/src/native/shim" -B $BuildDir -DCMAKE_BUILD_TYPE=Release
cmake --build $BuildDir --config Release

bun "$Root/scripts/stage-native.ts" "$BuildDir" "$Root/native/out/$Platform"
Write-Host "staged native artifacts -> native/out/$Platform"
