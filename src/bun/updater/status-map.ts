// feature 013: devkit UpdateStatusEntry → UpdateView mapping.
// Pure functions — the mapping table lives in specs/013-auto-update/data-model.md.
import type {
  UpdateStatusDetails,
  UpdateStatusEntry,
} from "electrobun/main/updater";
import type {
  UpdateErrorCode,
  UpdateStatus,
} from "../../shared/types";

const DOWNLOADING: ReadonlySet<string> = new Set([
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
]);

const READY: ReadonlySet<string> = new Set([
  "download-complete",
  "local-tar-found",
  "applying",
  "extracting",
  "replacing-app",
  "launching-new-version",
  "complete",
]);

export function mapStatus(s: string): UpdateStatus {
  if (s === "checking" || s === "check-complete") return "checking";
  if (s === "update-available") return "available";
  if (DOWNLOADING.has(s)) return "downloading";
  if (READY.has(s)) return "ready";
  if (s === "error" || s === "patch-failed" || s === "local-tar-missing")
    return "error";
  // no-update, idle, patch-* leftovers
  return "idle";
}

// artifact/integrity failures → UPDATE_INVALID (FR-004 named refusal);
// everything else → UPDATE_FAILED transport
const ARTIFACT_PATTERNS =
  /integrity|sha256|checksum|tar|manifest|prepared|extract|patch|disk|ENOSPC|signature/i;

export function mapErrorCode(message: string): UpdateErrorCode {
  return ARTIFACT_PATTERNS.test(message) ? "UPDATE_INVALID" : "UPDATE_FAILED";
}

export function mapProgress(
  details?: UpdateStatusDetails,
): { bytesDownloaded: number; totalBytes: number; percent: number } | undefined {
  if (details?.bytesDownloaded == null) return undefined;
  const total = details.totalBytes ?? 0;
  return {
    bytesDownloaded: details.bytesDownloaded,
    totalBytes: total,
    percent:
      details.progress ??
      (total > 0 ? Math.round((details.bytesDownloaded / total) * 100) : 0),
  };
}

// reduce a single status entry onto the running view fields the service
// tracks; returns null when the entry carries no view-visible change
export function reduceEntry(entry: UpdateStatusEntry): {
  status: UpdateStatus;
  errorCode?: UpdateErrorCode;
  message?: string;
  progress?: { bytesDownloaded: number; totalBytes: number; percent: number };
} {
  const status = mapStatus(entry.status);
  return {
    status,
    errorCode:
      status === "error" ? mapErrorCode(entry.message) : undefined,
    message: status === "error" ? entry.message : undefined,
    progress: mapProgress(entry.details),
  };
}
