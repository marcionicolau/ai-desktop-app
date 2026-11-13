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

// stall watchdog: any 60 s window without a response/bytes fails the
// download instead of letting a dead connection hang the process forever
export const STALL_MS = 60_000;

// .part files this process is actively writing; a .part on disk that
// isn't in this set is a stale artifact of a killed/stalled attempt
const inflight = new Set<string>();

export function downloadInFlight(partPath: string): boolean {
  return inflight.has(partPath);
}

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
// Fails with a stall error after stallMs without progress; a body that
// ends short of content-length is treated as a truncated download.
export async function downloadGguf(
  url: string,
  fileName: string,
  dir: string,
  onEvent: (s: DownloadState) => void,
  opts?: { fetchImpl?: typeof fetch; stallMs?: number },
): Promise<void> {
  const safeName = validateGgufTarget(url, fileName);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, safeName);
  const part = target + ".part";
  if (existsSync(target) || inflight.has(part)) {
    throw new EngineError("ALREADY_EXISTS", `${safeName} already exists`);
  }
  // a .part on disk that isn't inflight is a stale artifact of a
  // killed/stalled attempt — this process owns models/, discard it
  if (existsSync(part)) {
    unlinkSync(part);
  }
  inflight.add(part);
  const stallMs = opts?.stallMs ?? STALL_MS;
  const doFetch = opts?.fetchImpl ?? fetch;
  const ctl = new AbortController();
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let rejectStall!: (e: Error) => void;
  // rejects when nothing arrives for stallMs — raced against the fetch
  // and every body read so hung connects/streams can't pend forever
  const stalled = new Promise<never>((_, reject) => {
    rejectStall = reject;
  });
  const armStall = () => {
    stallTimer = setTimeout(() => {
      ctl.abort();
      rejectStall(
        new Error(
          `download stalled: no data for ${Math.max(1, Math.ceil(stallMs / 1000))}s`,
        ),
      );
    }, stallMs);
    stallTimer.unref?.();
  };
  armStall();
  let writer: ReturnType<ReturnType<typeof Bun.file>["writer"]> | null = null;
  try {
    const res = await Promise.race([
      doFetch(url, { redirect: "follow", signal: ctl.signal }),
      stalled,
    ]);
    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status}`);
    }
    const totalHeader = res.headers.get("content-length");
    const total = totalHeader ? Number(totalHeader) : null;
    // let consumers show "0 of N" right away instead of a bare
    // "Starting…" until the first 4 MiB chunk lands
    onEvent({
      fileName: safeName,
      phase: "progress",
      downloadedBytes: 0,
      totalBytes: total,
    });
    writer = Bun.file(part).writer();
    let downloaded = 0;
    let lastEmit = 0;
    const it = (res.body as unknown as AsyncIterable<Uint8Array>)[
      Symbol.asyncIterator
    ]();
    try {
      for (;;) {
        // oxlint-disable-next-line no-await-in-loop -- sequential pull per chunk is required
        const next = await Promise.race([it.next(), stalled]);
        if (next.done) break;
        clearTimeout(stallTimer);
        armStall();
        const chunk = next.value;
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
      if (total !== null && downloaded < total) {
        throw new Error(
          `download truncated: ${downloaded} of ${total} bytes`,
        );
      }
    } finally {
      clearTimeout(stallTimer);
      // never await return(): it stays pending while a pull is in
      // flight — abort() already detaches a real fetch body
      void it.return?.()?.catch(() => {});
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
      // end() returns a promise; swallow async failures without awaiting
      void Promise.resolve(writer?.end() ?? 0).catch(() => {});
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
  } finally {
    clearTimeout(stallTimer);
    inflight.delete(part);
  }
}
