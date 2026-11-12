// feature 013: devkit status → UpdateView mapping + error-code naming.
import { describe, expect, test } from "bun:test";
import {
  mapErrorCode,
  mapProgress,
  mapStatus,
  reduceEntry,
} from "../../../src/bun/updater/status-map";

describe("mapStatus", () => {
  test("check/update phases", () => {
    expect(mapStatus("checking")).toBe("checking");
    expect(mapStatus("check-complete")).toBe("checking");
    expect(mapStatus("update-available")).toBe("available");
    expect(mapStatus("no-update")).toBe("idle");
    expect(mapStatus("idle")).toBe("idle");
    expect(mapStatus("error")).toBe("error");
  });
  test("download-family statuses → downloading", () => {
    for (const s of [
      "downloading",
      "download-starting",
      "fetching-patch",
      "patch-found",
      "patch-not-found",
      "downloading-patch",
      "applying-patch",
      "patch-chain-complete",
      "downloading-full-bundle",
      "download-progress",
      "decompressing",
      "checking-local-tar",
      "extracting-version",
    ]) {
      expect(mapStatus(s)).toBe("downloading");
    }
  });
  test("ready-family statuses → ready", () => {
    for (const s of [
      "download-complete",
      "local-tar-found",
      "applying",
      "extracting",
      "replacing-app",
      "launching-new-version",
      "complete",
    ]) {
      expect(mapStatus(s)).toBe("ready");
    }
  });
  test("failure statuses → error", () => {
    expect(mapStatus("patch-failed")).toBe("error");
    expect(mapStatus("local-tar-missing")).toBe("error");
  });
});

describe("mapErrorCode", () => {
  test("artifact/integrity failures → UPDATE_INVALID", () => {
    for (const m of [
      "sha256 mismatch on artifact",
      "checksum failed",
      "Invalid update manifest: archive integrity metadata is required",
      "prepared update record invalid",
      "No space left on device (ENOSPC)",
      "signature verification failed",
    ]) {
      expect(mapErrorCode(m)).toBe("UPDATE_INVALID");
    }
  });
  test("transport failures → UPDATE_FAILED", () => {
    for (const m of [
      "Failed to check for updates: HTTP 404",
      "Failed to download update: network unreachable",
      "connection refused",
    ]) {
      expect(mapErrorCode(m)).toBe("UPDATE_FAILED");
    }
  });
});

describe("mapProgress", () => {
  test("derives percent from bytes when progress absent", () => {
    expect(mapProgress({ bytesDownloaded: 50, totalBytes: 200 })).toEqual({
      bytesDownloaded: 50,
      totalBytes: 200,
      percent: 25,
    });
  });
  test("prefers explicit progress", () => {
    expect(
      mapProgress({ bytesDownloaded: 50, totalBytes: 200, progress: 42 }),
    ).toMatchObject({ percent: 42 });
  });
  test("no bytes → undefined", () => {
    expect(mapProgress({})).toBeUndefined();
    expect(mapProgress(undefined)).toBeUndefined();
  });
});

describe("reduceEntry", () => {
  test("error entry surfaces code + message", () => {
    const r = reduceEntry({
      status: "error",
      message: "sha256 mismatch on artifact",
      timestamp: 0,
    });
    expect(r.status).toBe("error");
    expect(r.errorCode).toBe("UPDATE_INVALID");
    expect(r.message).toContain("sha256");
  });
  test("progress entry carries progress fields", () => {
    const r = reduceEntry({
      status: "download-progress",
      message: "50%",
      timestamp: 0,
      details: { bytesDownloaded: 10, totalBytes: 40 },
    });
    expect(r.status).toBe("downloading");
    expect(r.progress?.percent).toBe(25);
  });
});
