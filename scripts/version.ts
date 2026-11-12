// computeVersion — semver app version derived from git, no manual bumps.
//
// Rules:
//   tagged HEAD          → exact tag ("v1.2.3" → "1.2.3")
//   N commits past tag   → "X.Y.Z-<channel>.N"   (canary) / "X.Y.Z+N" (stable)
//   no tags              → "<package.json version>-<channel>.<total commits>"
// RELEASE_CHANNEL env (default "canary") picks the prerelease/build form.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function git(args: string[]): string | null {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function computeVersion(): string {
  const channel = process.env.RELEASE_CHANNEL === "stable" ? "stable" : "canary";

  const desc = git(["describe", "--tags", "--long"]);
  if (desc) {
    const m = desc.match(/^v?(\d+\.\d+\.\d+)-(\d+)-g[0-9a-f]+$/);
    if (m?.[1] && m[2]) {
      const [, base, n] = m;
      if (n === "0") return base;
      return channel === "stable" ? `${base}+${n}` : `${base}-canary.${n}`;
    }
    const exact = desc.match(/^v?(\d+\.\d+\.\d+)$/);
    if (exact?.[1]) return exact[1];
  }

  const pkg = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
  ) as { version: string };
  const total = git(["rev-list", "--count", "HEAD"]) ?? "0";
  return channel === "stable"
    ? `${pkg.version}+${total}`
    : `${pkg.version}-canary.${total}`;
}

if (import.meta.main) console.log(computeVersion());
