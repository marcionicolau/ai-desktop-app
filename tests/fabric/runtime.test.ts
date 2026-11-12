// feature 017 (T032): RunManager — run→trace→persist lifecycle, abort
// mid-run, abortPackRuns on disable, located failure, history list/get.
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContributionRegistry } from "../../src/bun/fabric/registry";
import { parseManifest } from "../../src/bun/fabric/frontmatter";
import { RunManager } from "../../src/bun/fabric/runtime";
import type { ComponentEngine } from "../../src/bun/fabric/components";
import type { RunStatus, TraceEntry } from "../../src/shared/types";

const FX = join(import.meta.dir, "../extensions/fixtures");
let reg: ContributionRegistry;

const manifest = parseManifest(
  "pack.yaml",
  readFileSync(join(FX, "notes-pack/pack.yaml"), "utf8"),
);

beforeEach(() => {
  process.env.APP_DATA_DIR = mkdtempSync(join(tmpdir(), "fabric-run-"));
  reg = new ContributionRegistry();
  reg.registerPack("notes-pack", join(FX, "notes-pack"), manifest);
});

const waitStatus = async (mgr: RunManager, runId: string, want: RunStatus[], tries = 400) => {
  for (let i = 0; i < tries; i++) {
    const r = mgr.get(runId);
    if (r && want.includes(r.status)) return r;
    await new Promise((r2) => setTimeout(r2, 5));
  }
  throw new Error(`run ${runId} never reached ${want.join("|")}`);
};

// both prompt steps share one answer shape: summarize_notes needs
// `summary`, action_items needs `actions` — extra keys are ignored
const answeringEngine = (answer = '{"summary":"s","actions":"a"}'): ComponentEngine => ({
  tokenCount: (t) => t.length,
  generate: async (_p, onToken) => {
    onToken(answer);
    return { status: "complete", tokens: 2, promptTokens: 4 };
  },
});

describe("RunManager", () => {
  test("pipeline run → trace events → completed record persisted", async () => {
    const events: TraceEntry[] = [];
    const statuses: RunStatus[] = [];
    const mgr = new RunManager({
      registry: reg,
      engine: () => answeringEngine(),
      onTrace: (_id, e) => events.push(e),
      onStatus: (_id, s) => statuses.push(s),
    });
    const runId = mgr.start({
      packId: "notes-pack",
      target: { kind: "pipeline", id: "notes-pack:document_summary" },
      objective: "digest the transcript",
      params: { transcript: "a long meeting transcript with many words spoken" },
    });
    const rec = await waitStatus(mgr, runId, ["completed", "failed"]);
    expect(rec.status).toBe("completed");
    expect(rec.trace.length).toBeGreaterThan(0);
    expect(rec.endedAt).toBeGreaterThan(0);
    expect(statuses).toContain("running");
    expect(events.length).toBe(rec.trace.length);
    // persisted + visible via list/get
    expect(mgr.list("notes-pack").some((r) => r.id === runId)).toBe(true);
    expect(mgr.get(runId)?.id).toBe(runId);
  });

  test("cancel mid-run → cancelled record, no orphan", async () => {
    let release: (() => void) | null = null;
    const blocking: ComponentEngine = {
      tokenCount: (t) => t.length,
      generate: (_p, onToken) =>
        new Promise((res) => {
          release = () => {
            onToken('{"summary":"x"}');
            res({ status: "complete", tokens: 1 });
          };
        }),
    };
    const mgr = new RunManager({ registry: reg, engine: () => blocking });
    const runId = mgr.start({
      packId: "notes-pack",
      target: { kind: "pipeline", id: "notes-pack:document_summary" },
      objective: "o",
      params: { transcript: "a long meeting transcript with many words spoken" },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(mgr.cancel(runId)).toBe(true);
    release?.();
    const rec = await waitStatus(mgr, runId, ["cancelled", "completed", "failed"]);
    expect(rec.status).toBe("cancelled");
    expect(mgr.isRunning()).toBe(false);
    expect(mgr.cancel("run_ghost")).toBe(false);
  });

  test("abortPackRuns cancels all in-flight runs for the pack", async () => {
    // simulates a real engine: stop() unblocks the pending generate
    let release: (() => void) | null = null;
    const stoppable: ComponentEngine = {
      tokenCount: () => 0,
      generate: (_p, onToken) =>
        new Promise((res) => {
          release = () => {
            onToken("{}");
            res({ status: "partial", tokens: 0 });
          };
        }),
      stop: () => release?.(),
    };
    const mgr = new RunManager({ registry: reg, engine: () => stoppable });
    mgr.start({
      packId: "notes-pack",
      target: { kind: "pipeline", id: "notes-pack:document_summary" },
      objective: "o",
      params: { transcript: "a long meeting transcript with many words spoken" },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(mgr.isRunning()).toBe(true);
    mgr.abortPackRuns("notes-pack");
    // drive() exits via the abort-aware step boundary
    await new Promise((r) => setTimeout(r, 30));
    expect(mgr.isRunning()).toBe(false);
  });

  test("failed step → failed run with located error", async () => {
    const boom: ComponentEngine = {
      tokenCount: () => 0,
      generate: () => Promise.reject(new Error("engine blew up")),
    };
    const mgr = new RunManager({ registry: reg, engine: () => boom });
    const runId = mgr.start({
      packId: "notes-pack",
      target: { kind: "pipeline", id: "notes-pack:document_summary" },
      objective: "o",
      params: { transcript: "a long meeting transcript with many words spoken" },
    });
    const rec = await waitStatus(mgr, runId, ["failed"]);
    expect(rec.status).toBe("failed");
    expect(rec.error?.message).toContain("engine blew up");
  });
});
