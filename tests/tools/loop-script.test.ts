// feature 023 T024: run_script through the tool loop — consent
// deferral, verdict ordering, result injection, grant reuse.
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runToolLoop, type LoopEngine } from "../../src/bun/tools/loop";
import { ToolService } from "../../src/bun/tools/service";
import { ScriptService } from "../../src/bun/scripts/service";
import { SessionManager } from "../../src/bun/scripts/session";
import type { ScriptBackend, ScriptCallRequest, ScriptCallResult } from "../../src/bun/scripts/backend";
import type { Settings, ToolCallRecord } from "../../src/shared/types";
import { DEFAULT_GENERATION } from "../../src/shared/types";

const dir = mkdtempSync(join(tmpdir(), "cz-loop-script-"));
process.env.APP_DATA_DIR = dir;
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const { ScriptStore } = await import("../../src/bun/scripts/store");

const mkSettings = (scripts?: Settings["scripts"]): Settings => ({
  activeModelPath: null,
  contextLimitWarning: true,
  generation: DEFAULT_GENERATION,
  modelOverrides: {},
  tags: [],
  scripts,
});

class FakeBackend implements ScriptBackend {
  readonly kind = "subprocess" as const;
  calls: ScriptCallRequest[] = [];
  async ensure() {}
  async call(_r: "python" | "r", req: ScriptCallRequest): Promise<ScriptCallResult> {
    this.calls.push(req);
    return {
      exitStatus: 0,
      stdout: `ran:${req.code}`,
      stderr: "",
      durationMs: 3,
      files: [],
      sessionRestarted: false,
    };
  }
  async reset() {}
  status() {
    return { state: "live" as const, calls: this.calls.length, restartCount: 0 };
  }
  async dispose() {}
}

const mkScripts = (mode: "ask" | "allow-session" | "deny", backend: FakeBackend) =>
  new ScriptService({
    store: new ScriptStore(),
    sessions: new SessionManager({
      backendFactory: () => backend,
      emit: () => {},
    }),
    getSettings: () =>
      mkSettings({
        mode,
        runtimes: { python: { path: "/usr/bin/env" } },
      }),
    emitRun: () => {},
  });

const mkTools = () =>
  new ToolService({
    getSettings: () => ({
      activeModelPath: null,
      contextLimitWarning: true,
      generation: DEFAULT_GENERATION,
      modelOverrides: {},
      tags: [],
      tools: { sandboxRoot: null, mode: "deny" },
    }),
  });

class FakeEngine implements LoopEngine {
  segments: string[] = [];
  prompts: string[] = [];
  private stopping = false;
  stop() {
    this.stopping = true;
  }
  tokenCount(t: string) {
    return Math.ceil(t.length / 4);
  }
  async generate(prompt: string, onToken: (d: string) => void) {
    this.prompts.push(prompt);
    this.stopping = false;
    const seg = this.segments.shift() ?? "";
    for (const ch of seg) {
      if (this.stopping) {
        return { status: "partial" as const, tokens: 5, elapsedMs: 1, warm: this.prompts.length > 1, promptTokens: 10 };
      }
      onToken(ch);
    }
    return { status: "complete" as const, tokens: seg.length, elapsedMs: 1, warm: this.prompts.length > 1, promptTokens: 10 };
  }
}

const mkOpts = (
  tools: ToolService,
  calls: ToolCallRecord[],
  extra?: Partial<Parameters<typeof runToolLoop>[2]>,
) => ({
  tools,
  conversationId: "conv1",
  messageId: "msg1",
  onDelta: () => {},
  onCall: (c: ToolCallRecord) => {
    const i = calls.findIndex((x) => x.id === c.id);
    if (i >= 0) calls[i] = { ...c };
    else calls.push({ ...c });
  },
  onBudgetWarning: () => {},
  isStopped: () => false,
  ...extra,
});

let seq = 0;
const seed = async (svc: ScriptService, name?: string, code = "print(n+1)") =>
  svc.upsert({
    name: name ?? `add-one-${++seq}`,
    runtime: "python",
    source: { kind: "stored", text: code },
    params: [{ name: "n", type: "number", required: true }],
  });

describe("run_script in the tool loop", () => {
  test("approved call executes + tool_result injected + model continues", async () => {
    const backend = new FakeBackend();
    const svc = mkScripts("allow-session", backend);
    const it = await seed(svc);
    const eng = new FakeEngine();
    eng.segments = [
       'Let me compute.\n```tool_call\n{"tool":"run_script","script":"' + it.id + '","args":{"n":41}}\n```\n', 
      "The result is above.",
    ];
    const calls: ToolCallRecord[] = [];
    const deltas: string[] = [];
    const r = await runToolLoop(eng, "prompt", {
      ...mkOpts(mkTools(), calls, { scripts: svc }),
      onDelta: (d) => deltas.push(d),
    });
    expect(r.status).toBe("complete");
    expect(backend.calls).toHaveLength(1);
    const call = calls.find((c) => c.status === "executed");
    expect(call?.script).toBe(it.id);
    expect(call?.args).toEqual({ n: 41 });
    expect(deltas.join("")).toContain("```tool_result");
    expect(deltas.join("")).toContain("ran:");
    // continuation prompt carries the result for the model
    expect(eng.prompts.at(-1)).toContain("ran:");
  });

  test("ask mode defers consent; deny refuses with denied status", async () => {
    const backend = new FakeBackend();
    const svc = mkScripts("ask", backend);
    const it = await seed(svc);
    const eng = new FakeEngine();
    eng.segments = [
       '```tool_call\n{"tool":"run_script","script":"' + it.id + '","args":{"n":1}}\n```\n', 
      "done",
    ];
    const calls: ToolCallRecord[] = [];
    const deltas: string[] = [];
    const p = runToolLoop(eng, "prompt", {
      ...mkOpts(mkTools(), calls, { scripts: svc }),
      onDelta: (d) => deltas.push(d),
    });
    // wait for pending then deny
    await new Promise((res) => setTimeout(res, 20));
    const pending = calls.find((c) => c.status === "pending");
    expect(pending).toBeTruthy();
    expect(svc.respond(pending!.id, "deny")).toBe(true);
    await p;
    expect(backend.calls).toHaveLength(0);
    expect(calls.find((c) => c.id === pending!.id)?.status).toBe("denied");
    expect(deltas.join("")).toContain('"status":"denied"');
  });

  test("unknown script → refused unknown-script, no execution", async () => {
    const backend = new FakeBackend();
    const svc = mkScripts("allow-session", backend);
    const eng = new FakeEngine();
    eng.segments = [
      '```tool_call\n{"tool":"run_script","script":"ghost"}\n```\n',
      "done",
    ];
    const calls: ToolCallRecord[] = [];
    const deltas: string[] = [];
    await runToolLoop(eng, "prompt", {
      ...mkOpts(mkTools(), calls, { scripts: svc }),
      onDelta: (d) => deltas.push(d),
    });
    expect(backend.calls).toHaveLength(0);
    const c = calls.find((x) => x.status === "refused");
    expect(c?.refuseReason).toBe("unknown-script");
  });

  test("invalid args → refused invalid-args", async () => {
    const backend = new FakeBackend();
    const svc = mkScripts("allow-session", backend);
    const it = await seed(svc);
    const eng = new FakeEngine();
    eng.segments = [
       '```tool_call\n{"tool":"run_script","script":"' + it.id + '","args":{"n":"x"}}\n```\n', 
      "done",
    ];
    const calls: ToolCallRecord[] = [];
    await runToolLoop(eng, "prompt", {
      ...mkOpts(mkTools(), calls, { scripts: svc }),
    });
    const c = calls.find((x) => x.status === "refused");
    expect(c?.refuseReason).toBe("invalid-args");
    expect(backend.calls).toHaveLength(0);
  });

  test("deny policy → refused disabled; no scripts dep → refused disabled", async () => {
    const backend = new FakeBackend();
    const svc = mkScripts("deny", backend);
    const eng = new FakeEngine();
    eng.segments = [
       '```tool_call\n{"tool":"run_script","script":"add-one","args":{"n":1}}\n```\n', 
      "done",
    ];
    const calls: ToolCallRecord[] = [];
    await runToolLoop(eng, "prompt", {
      ...mkOpts(mkTools(), calls, { scripts: svc }),
    });
    expect(calls.find((c) => c.status === "refused")?.refuseReason).toBe("disabled");

    const calls2: ToolCallRecord[] = [];
    const eng2 = new FakeEngine();
    eng2.segments = eng.segments = [];
    eng2.segments.push('```tool_call\n{"tool":"run_script","script":"x"}\n```\n', "done");
    await runToolLoop(eng2, "prompt", {
      ...mkOpts(mkTools(), calls2), // no scripts service at all
    });
    expect(calls2.find((c) => c.status === "refused")?.refuseReason).toBe("disabled");
  });
});
