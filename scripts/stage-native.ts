// stage-native.ts <buildDir> <outDir>
// Copies the shim and its runtime deps from the CMake build tree into the
// flat staging dir that electrobun.config.ts maps into app resources.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [buildDir, outDir] = process.argv.slice(2);
if (!buildDir || !outDir) {
  console.error("usage: bun scripts/stage-native.ts <buildDir> <outDir>");
  process.exit(1);
}

const patterns = [
  /^libllama_shim\.(so|dylib|dll)$/,
  /^llama_shim\.dll$/,
  /^libllama\.(so|dylib|dll)(?:\..*)?$/,
  /^llama\.dll$/,
  /^libggml[^/\\]*\.(so|dylib|dll)(?:\..*)?$/,
  /^ggml[^/\\]*\.dll$/,
];

function scan(dir: string): string[] {
  let found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // skip cmake internals and test trees
      if (!/CMakeFiles|Testing|examples|tools|tests/i.test(entry.name)) {
        found = found.concat(scan(full));
      }
    } else if (patterns.some((re) => re.test(entry.name))) {
      found.push(full);
    }
  }
  return found;
}

mkdirSync(outDir, { recursive: true });
const files = scan(buildDir);
if (files.length === 0) {
  console.error(`no native artifacts found under ${buildDir}`);
  process.exit(1);
}
for (const f of files) {
  const dest = join(outDir, f.split("/").pop()!);
  copyFileSync(f, dest);
  console.log(`  ${dest}`);
}
