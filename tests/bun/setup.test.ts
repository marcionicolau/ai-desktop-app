// feature 022: SetupService — injected deps, no network. Covers the
// spec acceptance paths: fresh → download+bind+load per role; ready →
// skip; partial state → provision only what's missing; failure → error
// + retry; FR-007 busy guard; run() single-flight.
import { describe, expect, test } from "bun:test";
import {
  PROVISION_MODELS,
  PROVISION_ROLES,
  SetupService,
  type ProvisionModel,
} from "../../src/bun/setup/service";
import type { DownloadState, SetupState } from "../../src/shared/types";

interface Fake {
  svc: SetupService;
  events: SetupState[];
  calls: { downloads: string[]; binds: string[]; loads: number };
  // test controls
  ready: Set<string>; // roles already bound to an existing file
  present: Set<string>; // files already in the models dir
  failDownload: boolean;
  failLoad: boolean;
}

function make(): Fake {
  const f: Fake = {
    svc: null as unknown as SetupService,
    events: [],
    calls: { downloads: [], binds: [], loads: 0 },
    ready: new Set(),
    present: new Set(),
    failDownload: false,
    failLoad: false,
  };
  f.svc = new SetupService({
    roleReady: (role) => f.ready.has(role),
    fileExists: (fileName) => f.present.has(fileName),
    download: async (m: ProvisionModel, onEvent: (s: DownloadState) => void) => {
      f.calls.downloads.push(m.fileName);
      if (f.failDownload) {
        const e = new Error("HTTP 503");
        onEvent({
          fileName: m.fileName,
          phase: "error",
          downloadedBytes: 0,
          totalBytes: null,
          error: e.message,
        });
        throw e;
      }
      onEvent({
        fileName: m.fileName,
        phase: "progress",
        downloadedBytes: 5 * 1024 * 1024,
        totalBytes: 400 * 1024 * 1024,
      });
      f.present.add(m.fileName);
    },
    bindRole: (role, n) => {
      f.calls.binds.push(`${role}:${n}`);
      f.ready.add(role);
    },
    load: async () => {
      f.calls.loads++;
      if (f.failLoad) throw new Error("llm load failed");
    },
    emit: (s) => f.events.push(s),
  });
  return f;
}

const fileFor = (role: string) =>
  PROVISION_MODELS.find((m) => m.role === role)!.fileName;

describe("SetupService", () => {
  test("fresh install → downloads each role's model, binds, loads once, done", async () => {
    const f = make();
    await f.svc.run();
    expect(f.calls.downloads).toEqual(
      PROVISION_MODELS.map((m) => m.fileName),
    );
    expect(f.calls.binds).toEqual(
      PROVISION_MODELS.map((m) => `${m.role}:${m.fileName}`),
    );
    expect(f.calls.loads).toBe(1);
    expect(f.svc.status().phase).toBe("done");
    // download progress streamed through setup.status events
    expect(
      f.events.some((e) => e.phase === "downloading" && e.downloadedBytes > 0),
    ).toBe(true);
    expect(f.events[f.events.length - 1]?.phase).toBe("done");
    // per-role provisioning rows: every provisioned role walked to done
    const t = f.svc.status().targets;
    expect(t.map((x) => x.role)).toEqual([...PROVISION_ROLES]);
    expect(t.every((x) => x.status === "done")).toBe(true);
    expect(t.map((x) => x.fileName)).toEqual(
      PROVISION_MODELS.map((m) => m.fileName),
    );
  });

  test("all roles bound to existing files → done without downloading", async () => {
    const f = make();
    for (const role of PROVISION_ROLES) f.ready.add(role);
    await f.svc.run();
    expect(f.calls.downloads).toHaveLength(0);
    expect(f.calls.loads).toBe(0);
    expect(f.svc.status().phase).toBe("done");
  });

  test("file present but role unbound → binds without downloading", async () => {
    const f = make();
    for (const m of PROVISION_MODELS) f.present.add(m.fileName);
    await f.svc.run();
    expect(f.calls.downloads).toHaveLength(0);
    expect(f.calls.binds).toEqual(
      PROVISION_MODELS.map((m) => `${m.role}:${m.fileName}`),
    );
    expect(f.calls.loads).toBe(1);
    expect(f.svc.status().phase).toBe("done");
  });

  test("partial setup → only the unbound/missing role is provisioned", async () => {
    const f = make();
    f.ready.add("default");
    f.present.add(fileFor("planner"));
    await f.svc.run();
    // planner's file already on disk → only executor downloads
    expect(f.calls.downloads).toEqual([fileFor("executor")]);
    expect(f.calls.binds).toEqual([
      `planner:${fileFor("planner")}`,
      `executor:${fileFor("executor")}`,
    ]);
    expect(f.svc.status().phase).toBe("done");
  });

  test("download failure → error state; retry resumes remaining files", async () => {
    const f = make();
    f.failDownload = true;
    await f.svc.run();
    expect(f.svc.status().phase).toBe("error");
    expect(f.svc.status().error).toBe("HTTP 503");
    expect(f.calls.binds).toEqual([]);
    f.failDownload = false;
    await f.svc.run();
    // first attempt died on file #1 → retry re-downloads all three
    expect(f.calls.downloads).toEqual([
      fileFor("default"),
      ...PROVISION_MODELS.map((m) => m.fileName),
    ]);
    expect(f.svc.status().phase).toBe("done");
  });

  test("load failure after download → error; ready roles skip re-download on retry", async () => {
    const f = make();
    f.failLoad = true;
    await f.svc.run();
    expect(f.svc.status().phase).toBe("error");
    expect(f.calls.binds).toEqual(
      PROVISION_MODELS.map((m) => `${m.role}:${m.fileName}`),
    );
    // all roles now bound → retry short-circuits to done, no re-download
    f.failLoad = false;
    await f.svc.run();
    expect(f.calls.downloads).toHaveLength(PROVISION_MODELS.length);
    expect(f.svc.status().phase).toBe("done");
  });

  test("FR-007: user download in flight → run() stays idle", async () => {
    const f = make();
    f.svc.noteUserDownload(true);
    await f.svc.run();
    expect(f.calls.downloads).toHaveLength(0);
    expect(f.svc.status().phase).toBe("idle");
    f.svc.noteUserDownload(false);
    await f.svc.run();
    expect(f.calls.downloads).toHaveLength(PROVISION_MODELS.length);
    expect(f.svc.status().phase).toBe("done");
  });

  test("run() is single-flight — concurrent calls share one exec", async () => {
    const f = make();
    await Promise.all([f.svc.run(), f.svc.run(), f.svc.run()]);
    expect(f.calls.downloads).toHaveLength(PROVISION_MODELS.length);
  });

  test("double-ended user download can't corrupt the busy counter", async () => {
    const f = make();
    f.svc.noteUserDownload(false);
    f.svc.noteUserDownload(false);
    await f.svc.run();
    expect(f.calls.downloads).toHaveLength(PROVISION_MODELS.length);
  });
});
