#!/usr/bin/env bun
// Release helper. The git tag is the single source of truth: pushing a v* tag
// makes the GitHub Actions packaging workflow build and upload the artifact
// set (.github/workflows/packaging.yml).
//
//   stag   tag vX.Y.Z-rc.N  -> canary-channel artifacts (release candidate)
//   prod   tag vX.Y.Z       -> stable-channel artifacts (HEAD must be the rc commit)
//
//   bun scripts/release.ts status             release state (stable tag, open rc train, HEAD)
//   bun scripts/release.ts preflight          clean main in sync with origin, checks green
//   bun scripts/release.ts stag [X.Y.Z-rc.N]  tag a release candidate (asks when omitted)
//   bun scripts/release.ts prod [X.Y.Z]       promote the validated rc (asks when omitted)
//
// Environment: SKIP_TESTS=1 skips `bun test`, ASSUME_YES=1 skips confirmations.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

process.chdir(join(import.meta.dir, ".."));

const STABLE_RE = /^v\d+\.\d+\.\d+$/;
const RC_RE = /^v\d+\.\d+\.\d+-rc\.\d+$/;

function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

const say = (msg: string) => console.log(`==> ${msg}`);

function confirm(question: string): boolean {
  if (process.env.ASSUME_YES === "1") return true;
  return (prompt(`${question} [y/N]`) ?? "").toLowerCase() === "y";
}

function git(args: string[]): string {
  const r = spawnSync("git", args, { encoding: "utf8" });
  if (r.status !== 0) die(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

function gitOrNull(args: string[]): string | null {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function run(cmd: string[]): void {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { stdio: "inherit" });
  if (r.status !== 0) die(`${cmd.join(" ")} failed (exit ${r.status})`);
}

const tags = (pattern: string) =>
  git(["tag", "--list", pattern, "--sort=-v:refname"]).split("\n").filter(Boolean);

const latestStable = () => tags("v*").find((t) => STABLE_RE.test(t)) ?? null;

const latestRcOf = (base: string) =>
  tags(`${base}-rc.*`).find((t) => RC_RE.test(t)) ?? null;

// Open train: highest version with release candidates that has no stable tag yet.
function openTrain(): string | null {
  for (const tag of tags("v*-rc.*")) {
    if (!RC_RE.test(tag)) continue;
    const base = tag.replace(/-rc\.\d+$/, "");
    if (!gitOrNull(["rev-parse", "-q", "--verify", `refs/tags/${base}`])) return base;
  }
  return null;
}

function bump(v: string, kind: "major" | "minor" | "patch"): string {
  const [major = 0, minor = 0, patch = 0] = v.split(".").map(Number);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function cmdStatus() {
  const train = openTrain();
  console.log(`latest stable tag: ${latestStable() ?? "none"}`);
  console.log(
    `open train:        ${train ?? "none"}${train ? ` (latest candidate ${latestRcOf(train)})` : ""}`,
  );
  console.log(`HEAD:              ${git(["rev-parse", "--short", "HEAD"])}`);
}

function cmdPreflight() {
  say("pre-flight checks");
  const branch = git(["branch", "--show-current"]);
  if (branch !== "main") die(`releases are cut from main (on '${branch}')`);
  if (git(["status", "--porcelain", "--untracked-files=no"]))
    die("working tree has uncommitted changes");
  git(["fetch", "--quiet", "--tags", "origin"]);
  if (git(["rev-parse", "HEAD"]) !== git(["rev-parse", "origin/main"]))
    die("main is not in sync with origin/main (pull or push first)");
  run(["bun", "run", "typecheck"]);
  run(["bun", "run", "lint"]);
  if (process.env.SKIP_TESTS === "1") console.log("SKIP_TESTS=1: bun test skipped");
  else run(["bun", "test", "./tests"]);
  say(`pre-flight ok at ${git(["rev-parse", "--short", "HEAD"])}`);
}

function repoUrl(): string | null {
  const url = gitOrNull(["remote", "get-url", "origin"]);
  const m = url?.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/);
  return m ? `https://github.com/${m[1]}` : null;
}

function pushTag(tag: string, effect: string) {
  if (gitOrNull(["rev-parse", "-q", "--verify", `refs/tags/${tag}`]))
    die(`tag ${tag} already exists`);
  console.log(`\ntag:    ${tag}`);
  console.log(`commit: ${git(["log", "-1", "--format=%h %s"])}`);
  console.log(`effect: ${effect}`);
  if (!confirm(`Create and push ${tag}?`)) die("aborted");
  git(["tag", "-a", tag, "-m", `Release ${tag.slice(1)}`]);
  git(["push", "origin", tag]);
  const repo = repoUrl();
  say(`pushed ${tag}${repo ? `: follow the run at ${repo}/actions` : ""}`);
}

function cmdStag(versionArg?: string) {
  cmdPreflight();
  let version = versionArg?.replace(/^v/, "") ?? "";
  if (!version) {
    const stable = latestStable();
    const base = stable?.slice(1) ?? "0.0.0";
    const train = openTrain();
    const options: { version: string; label: string }[] = [];
    if (train) {
      const rc = latestRcOf(train)!;
      const n = Number(rc.split("-rc.")[1]);
      options.push({
        version: `${train.slice(1)}-rc.${n + 1}`,
        label: `continue the open train ${train}`,
      });
    }
    for (const kind of ["patch", "minor", "major"] as const)
      options.push({ version: `${bump(base, kind)}-rc.1`, label: `new ${kind} release` });
    console.log(`\nlatest stable: ${stable ?? "none"}`);
    options.forEach((o, i) => console.log(`  ${i + 1}) ${o.version}   (${o.label})`));
    console.log(`  ${options.length + 1}) custom`);
    const choice = (prompt("choose [1]: ") ?? "").trim() || "1";
    if (choice === String(options.length + 1)) {
      version = (prompt("version (X.Y.Z-rc.N): ") ?? "").trim();
    } else {
      const idx = Number(choice);
      if (!Number.isInteger(idx) || idx < 1 || idx > options.length) die("invalid choice");
      version = options[idx - 1]!.version;
    }
  }
  if (!RC_RE.test(`v${version}`)) die(`'${version}' is not X.Y.Z-rc.N`);
  pushTag(`v${version}`, `CI builds the canary artifact set for v${version}`);
}

function cmdProd(versionArg?: string) {
  cmdPreflight();
  let version = versionArg?.replace(/^v/, "") ?? "";
  const train = openTrain();
  if (!version) {
    if (!train) die("no release candidate to promote: run 'stag' first");
    console.log(`open train: ${train} (latest candidate ${latestRcOf(train)})`);
    version = (prompt(`version to release [${train.slice(1)}]: `) ?? "").trim() || train.slice(1);
  }
  if (!STABLE_RE.test(`v${version}`)) die(`'${version}' is not X.Y.Z`);
  const rc = latestRcOf(`v${version}`);
  if (!rc)
    die(`v${version} has no release candidate: a production release must have run as an rc first`);
  if (git(["rev-parse", `${rc}^{commit}`]) !== git(["rev-parse", "HEAD"]))
    die(
      `HEAD is not the commit of ${rc}: release exactly what was validated ` +
        `(check out ${rc} or cut a new rc)`,
    );
  pushTag(`v${version}`, `CI builds the stable artifact set for v${version}`);
  console.log("Next: download the stable artifacts from the tag's packaging workflow run.");
}

const usage = () => {
  console.log(
    "usage: bun scripts/release.ts {status|preflight|stag [X.Y.Z-rc.N]|prod [X.Y.Z]}",
  );
  process.exit(2);
};

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case "status":
    cmdStatus();
    break;
  case "preflight":
    cmdPreflight();
    break;
  case "stag":
    cmdStag(rest[0]);
    break;
  case "prod":
    cmdProd(rest[0]);
    break;
  default:
    usage();
}
