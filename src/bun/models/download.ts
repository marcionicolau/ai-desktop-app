// Shared GGUF download core: HF allowlist validation, .part → atomic
// rename, throttled DownloadState progress events. Used by the
// model.download RPC handler and by first-run bootstrap (feature 022)
// so both flows follow identical rules.
import { existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { EngineError } from "../llama/engine";
import type { DownloadState } from "../../shared/types";

export const HF_GGUF_RE =
  /^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[^\s/]+\/[^\s/]+\.gguf(?:\?[^\s]*)?$/;

export function validateGgufTarget(url: string, fileName: string): string {
  if (!HF_GGUF_RE.test(url)) {
    throw new EngineError(
      "INVALID_URL",
      "only https://huggingface.co/<org>/<repo>/resolve/<rev>/<file>.gguf links are allowed",
    );
  }
  const safeName = basename(fileName.trim());
  if (!safeName.endsWith(".gguf") || safeName !== fileName.trim()) {
    throw new EngineError("INVALID_URL", "fileName must be a plain .gguf basename");
  }
  return safeName;
}

// Downloads url → dir/<fileName> via a .part file. onEvent receives
// progress/done/error DownloadState payloads (progress throttled to
// 4 MiB). Rejects after emitting error; .part is cleaned up on failure.
export async function downloadGguf(
  url: string,
  fileName: string,
  dir: string,
  onEvent: (s: DownloadState) => void,
): Promise<void> {
  const safeName = validateGgufTarget(url, fileName);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, safeName);
  const part = target + ".part";
  if (existsSync(target) || existsSync(part)) {
    throw new EngineError("ALREADY_EXISTS", `${safeName} already exists`);
  }
  let writer: ReturnType<ReturnType<typeof Bun.file>["writer"]> | null = null;
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status}`);
    }
    const totalHeader = res.headers.get("content-length");
    const total = totalHeader ? Number(totalHeader) : null;
    writer = Bun.file(part).writer();
    let downloaded = 0;
    let lastEmit = 0;
    const body = res.body as unknown as AsyncIterable<Uint8Array>;
    for await (const chunk of body) {
      writer.write(chunk);
      downloaded += chunk.byteLength;
      if (downloaded - lastEmit >= 4 * 1024 * 1024) {
        lastEmit = downloaded;
        onEvent({
          fileName: safeName,
          phase: "progress",
          downloadedBytes: downloaded,
          totalBytes: total,
        });
      }
    }
    await writer.end();
    writer = null;
    renameSync(part, target);
    onEvent({
      fileName: safeName,
      phase: "done",
      downloadedBytes: downloaded,
      totalBytes: downloaded,
    });
  } catch (e) {
    try {
      writer?.end();
    } catch {
      // writer may already be closed
    }
    try {
      unlinkSync(part);
    } catch {
      // .part may not exist yet
    }
    onEvent({
      fileName: safeName,
      phase: "error",
      downloadedBytes: 0,
      totalBytes: null,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}
