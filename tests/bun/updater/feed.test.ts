// feature 013: feed layer contract — manifest validation, downgrade
// guard, notes sidecar, preferred-channel isolation.
import { describe, expect, test } from "bun:test";
import {
  artifactUrl,
  checkChannelFeed,
  compareVersions,
  manifestUrl,
  validateManifest,
} from "../../../src/bun/updater/feed";

const INFO = {
  baseUrl: "https://example.test/feed",
  identifier: "dev.local.ai-desktop-app",
  version: "1.0.0-canary.4",
  hash: "basehash1",
};

const manifest = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  identifier: "dev.local.ai-desktop-app",
  channel: "canary",
  version: "1.1.0",
  hash: "newhash123",
  platform: "linux",
  arch: "x64",
  artifact: {
    file: "canary-linux-x64-newhash123.tar.zst",
    tarSha256: "a".repeat(64),
    tarSize: 1234,
  },
  ...over,
});

function fakeFetch(map: Record<string, { status: number; body: unknown }>) {
  return (async (url: string | URL) => {
    const key = String(url).split("?")[0]!;
    const hit = map[key];
    if (!hit) return new Response("nope", { status: 404 });
    return new Response(
      typeof hit.body === "string" ? hit.body : JSON.stringify(hit.body),
      { status: hit.status },
    );
  }) as typeof fetch;
}

describe("feed urls", () => {
  test("manifest url carries the channel-scoped prefix", () => {
    expect(manifestUrl("https://x.test/f/", "stable", "linux", "x64")).toBe(
      "https://x.test/f/stable-linux-x64-update-v2.json",
    );
  });
  test("artifact url encodes the file name", () => {
    expect(artifactUrl("https://x.test/f", "a b.tar.zst")).toBe(
      "https://x.test/f/a%20b.tar.zst",
    );
  });
});

describe("validateManifest", () => {
  test("valid manifest passes", () => {
    const m = validateManifest(manifest(), {
      identifier: INFO.identifier,
      channel: "canary",
      os: "linux",
      arch: "x64",
    });
    expect(m.version).toBe("1.1.0");
  });
  test("missing tarSha256 rejected (FR-004)", () => {
    const doc = manifest();
    // oxlint-disable-next-line no-dynamic-delete -- fixture mutation
    delete (doc.artifact as Record<string, unknown>).tarSha256;
    expect(() =>
      validateManifest(doc, {
        identifier: INFO.identifier,
        channel: "canary",
        os: "linux",
        arch: "x64",
      }),
    ).toThrow(/tarSha256/);
  });
  test("channel mismatch rejected — stable never parses a canary manifest", () => {
    expect(() =>
      validateManifest(manifest(), {
        identifier: INFO.identifier,
        channel: "stable",
        os: "linux",
        arch: "x64",
      }),
    ).toThrow(/identity/);
  });
  test("unsafe artifact.file rejected", () => {
    const doc = manifest();
    doc.artifact.file = "../evil.tar.zst";
    expect(() =>
      validateManifest(doc, {
        identifier: INFO.identifier,
        channel: "canary",
        os: "linux",
        arch: "x64",
      }),
    ).toThrow(/artifact\.file/);
  });
});

describe("compareVersions", () => {
  test("core triple ordering", () => {
    expect(compareVersions("1.1.0", "1.0.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.1.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
  test("release > prerelease; rc ordering numeric", () => {
    expect(compareVersions("1.0.0", "1.0.0-rc.2")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-rc.10", "1.0.0-rc.2")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-canary.4", "1.0.0-rc.1")).toBeLessThan(0);
  });
  test("post-tag channel suffix (<tag>-canary.N) is older than the next tag", () => {
    // computeVersion() stamps local builds "0.0.1-rc.4-canary.3" — the
    // trailing "-canary.N" is a build increment, not a prerelease
    // identifier; without special-casing it, "rc.4-canary.3" wrongly
    // sorts NEWER than "rc.6" and the feed check treats a real upgrade
    // as a downgrade (bug: canary build reported "up to date" vs rc.6)
    expect(
      compareVersions("0.0.1-rc.6", "0.0.1-rc.4-canary.3"),
    ).toBeGreaterThan(0);
    expect(
      compareVersions("0.0.1-rc.4-canary.3", "0.0.1-rc.6"),
    ).toBeLessThan(0);
    expect(
      compareVersions("0.0.1-rc.6-canary.2", "0.0.1-rc.6"),
    ).toBeGreaterThan(0);
  });
});

describe("checkChannelFeed", () => {
  const mUrl = manifestUrl(INFO.baseUrl, "canary", "linux", "x64");
  const nUrl = "https://example.test/feed/canary-linux-x64-notes.md";

  test("newer manifest + notes → ReleaseDescriptor with changelog+date", async () => {
    const r = await checkChannelFeed(INFO, "canary", "linux", "x64", {
      fetchImpl: fakeFetch({
        [mUrl]: { status: 200, body: manifest() },
        [nUrl]: {
          status: 200,
          body: "date: 2026-02-19\n- feat: updater\n- fix: crash",
        },
      }),
    });
    expect(r?.version).toBe("1.1.0");
    expect(r?.changelog).toContain("feat: updater");
    expect(r?.publishedAt).toBe("2026-02-19");
    expect(r?.tarSha256).toBe("a".repeat(64));
  });

  test("older manifest ignored (downgrade guard)", async () => {
    const r = await checkChannelFeed(INFO, "canary", "linux", "x64", {
      fetchImpl: fakeFetch({
        [mUrl]: { status: 200, body: manifest({ version: "0.9.0" }) },
      }),
    });
    expect(r).toBeNull();
  });

  test("same hash → null (identical build)", async () => {
    const r = await checkChannelFeed(INFO, "canary", "linux", "x64", {
      fetchImpl: fakeFetch({
        [mUrl]: { status: 200, body: manifest({ hash: INFO.hash }) },
      }),
    });
    expect(r).toBeNull();
  });

  test("notes 404 → empty changelog, not an error", async () => {
    const r = await checkChannelFeed(INFO, "canary", "linux", "x64", {
      fetchImpl: fakeFetch({ [mUrl]: { status: 200, body: manifest() } }),
    });
    expect(r?.changelog).toBe("");
  });

  test("feed error throws (caller degrades)", async () => {
    await expect(
      checkChannelFeed(INFO, "canary", "linux", "x64", {
        fetchImpl: fakeFetch({}),
      }),
    ).rejects.toThrow(/HTTP 404/);
  });

  test("preferred-channel isolation: stable request fetches stable manifest only", async () => {
    const sUrl = manifestUrl(INFO.baseUrl, "stable", "linux", "x64");
    const stable = manifest({ channel: "stable", version: "1.0.0", hash: "stable1" });
    const r = await checkChannelFeed(INFO, "stable", "linux", "x64", {
      fetchImpl: fakeFetch({
        [sUrl]: { status: 200, body: stable },
        [mUrl]: { status: 200, body: manifest({ version: "9.9.9" }) },
      }),
    });
    expect(r?.channel).toBe("stable");
    expect(r?.version).toBe("1.0.0");
  });
});
