// feature 022: SetupService — injected deps, no network. Covers the
// spec acceptance paths: fresh → download+bind+load; usable → skip;
// failure → error + retry; FR-007 busy guard; run() single-flight.
import { describe, expect, test } from "bun:test";
import { DEFAULT_MODEL, SetupService } from "../../src/bun/setup/service";
import type { DownloadState, SetupState } from "../../src/shared/types";

interface Fake {
  svc: SetupService;
  events: SetupState[];
  calls: { downloads: number; binds: string[]; loads: number };
  // test controls
  usable: boolean;
  failDownload: boolean;
  failLoad: boolean;
}

function make(): Fake {
  const f: Fake = {
    svc: null as unknown as SetupService,
    events: [],
    calls: { downloads: 0, binds: [], loads: 0 },
    usable: false,
    failDownload: false,
    failLoad: false,
  };
  f.svc = new SetupService({
    hasUsableModel: () => f.usable,
    download: async (onEvent: (s: DownloadState) => void) => {
      f.calls.downloads++;
      if (f.failDownload) {
        const e = new Error("HTTP 503");
        onEvent({
          fileName: DEFAULT_MODEL.fileName,
          phase: "error",
          downloadedBytes: 0,
          totalBytes: null,
          error: e.message,
        });
        throw e;
      }
      onEvent({
        fileName: DEFAULT_MODEL.fileName,
        phase: "progress",
        downloadedBytes: 5 * 1024 * 1024,
        totalBytes: 400 * 1024 * 1024,
      });
    },
    bindDefault: (n) => f.calls.binds.push(n),
    load: async () => {
      f.calls.loads++;
      if (f.failLoad) throw new Error("llm load failed");
    },
    emit: (s) => f.events.push(s),
  });
  return f;
}

describe("SetupService", () => {
  test("fresh install → download, bind default, load, done", async () => {
    const f = make();
    await f.svc.run();
    expect(f.calls.downloads).toBe(1);
    expect(f.calls.binds).toEqual([DEFAULT_MODEL.fileName]);
    expect(f.calls.loads).toBe(1);
    expect(f.svc.status().phase).toBe("done");
    // download progress streamed through setup.status events
    expect(f.events.some((e) => e.phase === "downloading" && e.downloadedBytes > 0)).toBe(
      true,
    );
    expect(f.events[f.events.length - 1]?.phase).toBe("done");
  });

  test("usable model → done without downloading", async () => {
    const f = make();
    f.usable = true;
    await f.svc.run();
    expect(f.calls.downloads).toBe(0);
    expect(f.calls.loads).toBe(0);
    expect(f.svc.status().phase).toBe("done");
  });

  test("download failure → error state; retry re-downloads", async () => {
    const f = make();
    f.failDownload = true;
    await f.svc.run();
    expect(f.svc.status().phase).toBe("error");
    expect(f.svc.status().error).toBe("HTTP 503");
    expect(f.calls.binds).toEqual([]);
    f.failDownload = false;
    await f.svc.run();
    expect(f.calls.downloads).toBe(2);
    expect(f.svc.status().phase).toBe("done");
  });

  test("load failure after download → error, no re-download on retry when model now usable", async () => {
    const f = make();
    f.failLoad = true;
    await f.svc.run();
    expect(f.svc.status().phase).toBe("error");
    expect(f.calls.binds).toEqual([DEFAULT_MODEL.fileName]);
    // file landed + bound → a rescan reports usable, so retry skips to done
    f.usable = true;
    f.failLoad = false;
    await f.svc.run();
    expect(f.calls.downloads).toBe(1);
    expect(f.svc.status().phase).toBe("done");
  });

  test("FR-007: user download in flight → run() stays idle", async () => {
    const f = make();
    f.svc.noteUserDownload(true);
    await f.svc.run();
    expect(f.calls.downloads).toBe(0);
    expect(f.svc.status().phase).toBe("idle");
    f.svc.noteUserDownload(false);
    await f.svc.run();
    expect(f.calls.downloads).toBe(1);
    expect(f.svc.status().phase).toBe("done");
  });

  test("run() is single-flight — concurrent calls share one exec", async () => {
    const f = make();
    await Promise.all([f.svc.run(), f.svc.run(), f.svc.run()]);
    expect(f.calls.downloads).toBe(1);
  });

  test("double-ended user download can't corrupt the busy counter", async () => {
    const f = make();
    f.svc.noteUserDownload(false);
    f.svc.noteUserDownload(false);
    await f.svc.run();
    expect(f.calls.downloads).toBe(1);
  });
});
