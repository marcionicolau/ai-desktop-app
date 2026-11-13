// models/download: stall watchdog, early-EOF truncation detection, stale
// .part recovery, in-flight duplicate guard. fetchImpl keeps it offline.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  downloadGguf,
  downloadInFlight,
} from "../../src/bun/models/download";
import { EngineError } from "../../src/bun/llama/engine";
import type { DownloadState } from "../../src/shared/types";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const URL = "https://huggingface.co/o/r/resolve/main/m.gguf";
const BYTES = new Uint8Array([1, 2, 3, 4, 5]);

function streamOf(chunks: Uint8Array[], close = true): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      if (close) c.close();
    },
  });
}

// totalOverride fakes a larger content-length than the body delivers
// (mid-stream EOF); omit it for a bare stream with no length header
function fakeFetch(
  chunks: Uint8Array[],
  opts?: { hang?: boolean; totalOverride?: number },
): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(streamOf(chunks, !opts?.hang), {
        headers:
          opts?.totalOverride === undefined
            ? { "content-length": String(chunks.reduce((n, c) => n + c.byteLength, 0)) }
            : { "content-length": String(opts.totalOverride) },
      }),
    )) as unknown as typeof fetch;
}

describe("downloadGguf", () => {
  let dir: string;
  let events: DownloadState[];
  const onEvent = (s: DownloadState) => events.push(s);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dl-core-"));
    events = [];
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("completes: .part renamed to target, done event emitted", async () => {
    await downloadGguf(URL, "m.gguf", dir, onEvent, {
      fetchImpl: fakeFetch([BYTES]),
    });
    expect(readFileSync(join(dir, "m.gguf"))).toEqual(BYTES);
    expect(existsSync(join(dir, "m.gguf.part"))).toBe(false);
    // a 0-byte progress event fires as soon as headers land so the UI
    // can show "0 of N" instead of a bare indeterminate state
    expect(events[0]).toEqual({
      fileName: "m.gguf",
      phase: "progress",
      downloadedBytes: 0,
      totalBytes: BYTES.byteLength,
    });
    expect(events.at(-1)?.phase).toBe("done");
  });

  test("stalled stream fails instead of hanging forever", async () => {
    await expect(
      downloadGguf(URL, "m.gguf", dir, onEvent, {
        fetchImpl: fakeFetch([], { hang: true, totalOverride: 100 }),
        stallMs: 25,
      }),
    ).rejects.toThrow("download stalled");
    expect(events.at(-1)?.phase).toBe("error");
    expect(existsSync(join(dir, "m.gguf.part"))).toBe(false);
    expect(downloadInFlight(join(dir, "m.gguf.part"))).toBe(false);
  });

  test("early EOF vs content-length is an error, not a done", async () => {
    await expect(
      downloadGguf(URL, "m.gguf", dir, onEvent, {
        fetchImpl: fakeFetch([BYTES], { totalOverride: BYTES.byteLength + 10 }),
      }),
    ).rejects.toThrow("truncated");
    expect(events.at(-1)?.phase).toBe("error");
    expect(existsSync(join(dir, "m.gguf"))).toBe(false);
    expect(existsSync(join(dir, "m.gguf.part"))).toBe(false);
  });

  test("stale .part is discarded so retries can proceed", async () => {
    writeFileSync(join(dir, "m.gguf.part"), "stale");
    await downloadGguf(URL, "m.gguf", dir, onEvent, {
      fetchImpl: fakeFetch([BYTES]),
    });
    expect(readFileSync(join(dir, "m.gguf"))).toEqual(BYTES);
    expect(events.at(-1)?.phase).toBe("done");
  });

  test("concurrent duplicate of the same file rejects ALREADY_EXISTS", async () => {
    const first = downloadGguf(URL, "m.gguf", dir, onEvent, {
      fetchImpl: fakeFetch([], { hang: true, totalOverride: 100 }),
      stallMs: 25,
    });
    try {
      await downloadGguf(URL, "m.gguf", dir, onEvent, {
        fetchImpl: fakeFetch([BYTES]),
      });
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("ALREADY_EXISTS");
    }
    await expect(first).rejects.toThrow("download stalled");
  });

  test("existing final file rejects ALREADY_EXISTS", async () => {
    writeFileSync(join(dir, "m.gguf"), "x");
    try {
      await downloadGguf(URL, "m.gguf", dir, onEvent, {
        fetchImpl: fakeFetch([BYTES]),
      });
      expect.unreachable();
    } catch (e) {
      expect((e as EngineError).code).toBe("ALREADY_EXISTS");
    }
  });
});
