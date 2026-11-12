// feature 013: preferred-channel feed check (contracts/feed.md).
// Validates the Electrobun update manifest ourselves so the check honors
// the *selected* channel — the devkit Updater only fetches the installed
// channel (research.md D4). Download/apply still delegate to the devkit.
import type {
  LocalUpdateInfo,
} from "./types-internal";
import type { ReleaseDescriptor, UpdateChannel } from "../../shared/types";

export interface UpdateManifest {
  schemaVersion: number;
  identifier: string;
  channel: string;
  version: string;
  hash: string;
  platform: string;
  arch: string;
  artifact: { file: string; tarSha256?: string; tarSize?: number };
}

const SAFE_HASH = /^[a-zA-Z0-9]+$/;
const SAFE_FILE = /^[a-zA-Z0-9._-]+$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function platformPrefix(
  channel: UpdateChannel,
  os: string,
  arch: string,
): string {
  return `${channel}-${os}-${arch}`;
}

export function manifestUrl(
  baseUrl: string,
  channel: UpdateChannel,
  os: string,
  arch: string,
): string {
  return `${baseUrl.replace(/\/+$/, "")}/${platformPrefix(channel, os, arch)}-update-v2.json`;
}

export function notesUrl(
  baseUrl: string,
  channel: UpdateChannel,
  os: string,
  arch: string,
): string {
  return `${baseUrl.replace(/\/+$/, "")}/${platformPrefix(channel, os, arch)}-notes.md`;
}

export function artifactUrl(baseUrl: string, file: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(file)}`;
}

// mirrors the devkit's safety checks: identity match, safe identity
// components, mandatory tarSha256 in v2 manifests
export function validateManifest(
  doc: unknown,
  expected: { identifier: string; channel: string; os: string; arch: string },
): UpdateManifest {
  if (typeof doc !== "object" || doc === null)
    throw new Error("update manifest is not an object");
  const d = doc as Record<string, unknown>;
  const str = (k: string) => {
    const v = d[k];
    if (typeof v !== "string" || v.length === 0)
      throw new Error(`update manifest missing ${k}`);
    return v;
  };
  const manifest: UpdateManifest = {
    schemaVersion: d["schemaVersion"] === 1 ? 1 : -1,
    identifier: str("identifier"),
    channel: str("channel"),
    version: str("version"),
    hash: str("hash"),
    platform: str("platform"),
    arch: str("arch"),
    artifact: (() => {
      const a = d["artifact"];
      if (typeof a !== "object" || a === null)
        throw new Error("update manifest missing artifact");
      const rec = a as Record<string, unknown>;
      if (typeof rec["file"] !== "string" || !SAFE_FILE.test(rec["file"]))
        throw new Error("update manifest has unsafe artifact.file");
      const tarSha256 = rec["tarSha256"];
      if (typeof tarSha256 !== "string" || !SHA256.test(tarSha256))
        throw new Error(
          "update manifest missing artifact.tarSha256 integrity metadata",
        );
      const tarSize = rec["tarSize"];
      return {
        file: rec["file"],
        tarSha256,
        tarSize:
          typeof tarSize === "number" && tarSize > 0 ? tarSize : undefined,
      };
    })(),
  };
  if (manifest.schemaVersion !== 1)
    throw new Error("unsupported update manifest schemaVersion");
  if (
    manifest.identifier !== expected.identifier ||
    manifest.channel !== expected.channel ||
    manifest.platform !== expected.os ||
    manifest.arch !== expected.arch
  )
    throw new Error("update manifest identity mismatch");
  if (!SAFE_HASH.test(manifest.hash))
    throw new Error("update manifest has unsafe hash");
  return manifest;
}

const parseVersion = (v: string) => {
  const [core, ...pre] = v.split("-");
  const nums = (core ?? "0")
    .split(".")
    .map((n) => Number.parseInt(n, 10) || 0);
  return { nums, pre: pre.join("-") };
};

// semver-ish compare on the version triple (+ prerelease): >=0 newer,
// <0 older, 0 equal. Versions like "1.2.3-canary.4" compare prerelease
// segments numerically after the core.
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1; // release > prerelease
  if (!y.pre) return -1;
  const xa = x.pre.split(".");
  const ya = y.pre.split(".");
  for (let i = 0; i < Math.max(xa.length, ya.length); i++) {
    const xi = xa[i];
    const yi = ya[i];
    if (xi === undefined) return -1;
    if (yi === undefined) return 1;
    const xn = Number.parseInt(xi, 10);
    const yn = Number.parseInt(yi, 10);
    const numX = !Number.isNaN(xn) && String(xn) === xi;
    const numY = !Number.isNaN(yn) && String(yn) === yi;
    if (numX && numY && xn !== yn) return Math.sign(xn - yn);
    if (numX !== numY) return numX ? -1 : 1;
    if (xi !== yi) return xi < yi ? -1 : 1;
  }
  return 0;
}

export interface FeedDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

// fetch + validate the preferred channel's manifest and its notes
// sidecar; returns a ReleaseDescriptor or null when nothing newer exists
// (downgrades ignored per spec). Throws on transport/manifest errors —
// the caller decides silent vs surfaced.
export async function checkChannelFeed(
  info: Pick<LocalUpdateInfo, "baseUrl" | "identifier" | "version" | "hash">,
  preferred: UpdateChannel,
  os: string,
  arch: string,
  deps: FeedDeps = {},
): Promise<ReleaseDescriptor | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const url = manifestUrl(info.baseUrl, preferred, os, arch);
  const res = await fetchImpl(`${url}?${Date.now()}`, {
    signal: AbortSignal.timeout(deps.timeoutMs ?? 5_000),
  });
  if (!res.ok) throw new Error(`feed check failed: HTTP ${res.status}`);
  const manifest = validateManifest(await res.json(), {
    identifier: info.identifier,
    channel: preferred,
    os,
    arch,
  });
  // downgrade guard: strictly older version on the feed is ignored
  if (compareVersions(manifest.version, info.version) < 0) return null;
  if (manifest.hash === info.hash) return null; // identical build

  let changelog = "";
  let publishedAt: string | undefined;
  try {
    const notes = await fetchImpl(notesUrl(info.baseUrl, preferred, os, arch), {
      signal: AbortSignal.timeout(deps.timeoutMs ?? 5_000),
    });
    if (notes.ok) {
      const text = await notes.text();
      const dateMatch = text.match(/^date:\s*(\S+)/m);
      publishedAt = dateMatch?.[1];
      changelog = text.replace(/^date:.*\n?/, "").trim();
    }
  } catch {
    // notes sidecar is optional — changelog stays empty
  }

  return {
    version: manifest.version,
    channel: preferred,
    hash: manifest.hash,
    artifactUrl: artifactUrl(info.baseUrl, manifest.artifact.file),
    tarSha256: manifest.artifact.tarSha256!,
    tarSize: manifest.artifact.tarSize,
    changelog,
    publishedAt,
  };
}
