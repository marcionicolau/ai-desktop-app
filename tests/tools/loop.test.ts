import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runToolLoop, type LoopEngine } from "../../src/bun/tools/loop";
import { ToolService } from "../../src/bun/tools/service";
import type { Settings, ToolCallRecord } from "../../src/shared/types";
import { DEFAULT_GENERATION } from "../../src/shared/types";

const dir = join(tmpdir(), `loop-test-${process.pid}-${Date.now().toString(36)}`);
beforeAll(() => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "a.txt"), "ALBATROSS");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const mkSettings = (tools?: Settings["tools"]): Settings => ({
  activeModelPath: null,
  contextLimitWarning: true,
  generation: DEFAULT_GENERATION,
  modelOverrides: {},
  tags: [],
  tools,
});

// fake engine: generate() emits the queued segments as token deltas,
// honoring stop() like the real decode loop
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
  async generate(
    prompt: string,
    onToken: (d: string) => void,
  ): Promise<{ status: "complete" | "partial"; tokens: number; elapsedMs: number; warm: boolean; promptTokens: number }> {
    this.prompts.push(prompt);
    this.stopping = false;
    const seg = this.segments.shift() ?? "";
    // emit char-by-char; a tool_call block stops mid-segment like the
    // real engine (detection needs the closing fence)
    for (const ch of seg) {
      if (this.stopping) {
        return { status: "partial", tokens: 5, elapsedMs: 1, warm: this.prompts.length > 1, promptTokens: 10 };
      }
      onToken(ch);
    }
    return { status: "complete", tokens: seg.length, elapsedMs: 1, warm: this.prompts.length > 1, promptTokens: 10 };
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

const active = () =>
  new ToolService({
    getSettings: () =>
      mkSettings({ sandboxRoot: dir, mode: "allow-read-session" }),
  });

describe("runToolLoop", () => {
  test("plain turn without blocks passes through", async () => {
    const eng = new FakeEngine();
    eng.segments = ["just an answer"];
    const calls: ToolCallRecord[] = [];
    const r = await runToolLoop(eng, "PROMPT", mkOpts(active(), calls));
    expect(r.status).toBe("complete");
    expect(r.calls).toEqual([]);
    expect(eng.prompts).toEqual(["PROMPT"]);
  });

  test("auto-approved read executes and continues", async () => {
    const eng = new FakeEngine();
    eng.segments = [
      'checking\n```tool_call\n{"tool":"read_file","path":"a.txt"}\n```',
      "\nthe word is ALBATROSS",
    ];
    const calls: ToolCallRecord[] = [];
    let stream = "";
    const r = await runToolLoop(eng, "PROMPT", {
      ...mkOpts(active(), calls),
      onDelta: (d) => (stream += d),
    });
    expect(r.status).toBe("complete");
    expect(calls).toHaveLength(1);
    expect(calls[0].status).toBe("executed");
    expect(calls[0].resolvedPath).toBe(join(dir, "a.txt"));
    // result block injected into the stream + continuation prompt
    expect(stream).toContain("tool_result");
    expect(stream).toContain("ALBATROSS");
    expect(eng.prompts).toHaveLength(2);
    expect(eng.prompts[1]).toContain("tool_result");
    expect(eng.prompts[1].startsWith("PROMPT")).toBe(true);
  });

  test("pending call + approve decision executes", async () => {
    const svc = new ToolService({
      getSettings: () => mkSettings({ sandboxRoot: dir, mode: "ask" }),
    });
    const eng = new FakeEngine();
    eng.segments = [
      '```tool_call\n{"tool":"read_file","path":"a.txt"}\n```',
      "done",
    ];
    const calls: ToolCallRecord[] = [];
    // approve as soon as the pending record is emitted
    const p = runToolLoop(eng, "PROMPT", {
      ...mkOpts(svc, calls),
      onCall: (c) => {
        const i = calls.findIndex((x) => x.id === c.id);
        if (i >= 0) calls[i] = { ...c };
        else calls.push({ ...c });
        if (c.status === "pending") svc.respond(c.id, "approve");
      },
    });
    const r = await p;
    expect(r.status).toBe("complete");
    expect(calls.map((c) => c.status)).toEqual(["executed"]);
  });

  test("deny feeds a denial result back", async () => {
    const svc = new ToolService({
      getSettings: () => mkSettings({ sandboxRoot: dir, mode: "ask" }),
    });
    const eng = new FakeEngine();
    eng.segments = [
      '```tool_call\n{"tool":"read_file","path":"a.txt"}\n```',
      "ok, can't see it",
    ];
    const calls: ToolCallRecord[] = [];
    let stream = "";
    const r = await runToolLoop(eng, "PROMPT", {
      ...mkOpts(svc, calls),
      onDelta: (d) => (stream += d),
      onCall: (c) => {
        const i = calls.findIndex((x) => x.id === c.id);
        if (i >= 0) calls[i] = { ...c };
        else calls.push({ ...c });
        if (c.status === "pending") svc.respond(c.id, "deny");
      },
    });
    expect(r.status).toBe("complete");
    expect(calls[0].status).toBe("denied");
    expect(stream).toContain("denied");
    expect(eng.prompts[1]).toContain("denied");
  });

  test("out-of-sandbox refuses without prompting", async () => {
    const svc = new ToolService({
      getSettings: () => mkSettings({ sandboxRoot: dir, mode: "ask" }),
    });
    const eng = new FakeEngine();
    eng.segments = [
      '```tool_call\n{"tool":"read_file","path":"../etc/passwd"}\n```',
      "sorry",
    ];
    const calls: ToolCallRecord[] = [];
    const r = await runToolLoop(eng, "PROMPT", mkOpts(svc, calls));
    expect(r.status).toBe("complete");
    expect(calls).toHaveLength(1);
    expect(calls[0].status).toBe("refused");
    expect(calls[0].refuseReason).toBe("out-of-sandbox");
  });

  test("malformed block consumes a slot and feeds back an error", async () => {
    const eng = new FakeEngine();
    eng.segments = [
      '```tool_call\n{"tool":"delete_everything"}\n```',
      "oops",
    ];
    const calls: ToolCallRecord[] = [];
    let stream = "";
    const r = await runToolLoop(eng, "PROMPT", {
      ...mkOpts(active(), calls),
      onDelta: (d) => (stream += d),
    });
    expect(r.status).toBe("complete");
    expect(calls[0].status).toBe("refused");
    expect(calls[0].refuseReason).toBe("malformed");
    expect(stream).toContain("malformed");
  });

  test("cap of 5 disarms further blocks", async () => {
    const eng = new FakeEngine();
    eng.segments = [
      '```tool_call\n{"tool":"read_file","path":"a.txt"}\n```',
      '```tool_call\n{"tool":"read_file","path":"a.txt"}\n```',
      '```tool_call\n{"tool":"read_file","path":"a.txt"}\n```',
      '```tool_call\n{"tool":"read_file","path":"a.txt"}\n```',
      '```tool_call\n{"tool":"read_file","path":"a.txt"}\n```',
      // 6th block emitted while disarmed — runs to completion
      '```tool_call\n{"tool":"read_file","path":"a.txt"}\n```\nfinal',
    ];
    const calls: ToolCallRecord[] = [];
    let warned = 0;
    const r = await runToolLoop(eng, "PROMPT", {
      ...mkOpts(active(), calls),
      onBudgetWarning: () => warned++,
    });
    expect(r.status).toBe("complete");
    expect(warned).toBe(1);
    const executed = calls.filter((c) => c.status === "executed");
    const budgetRefused = calls.filter(
      (c) => c.status === "refused" && c.refuseReason === "budget",
    );
    expect(executed).toHaveLength(5);
    expect(budgetRefused).toHaveLength(1);
  });

  test("user stop during pending discards the call → partial", async () => {
    const svc = new ToolService({
      getSettings: () => mkSettings({ sandboxRoot: dir, mode: "ask" }),
    });
    const eng = new FakeEngine();
    eng.segments = [
      '```tool_call\n{"tool":"read_file","path":"a.txt"}\n```',
      "never",
    ];
    const calls: ToolCallRecord[] = [];
    let stopped = false;
    const r = await runToolLoop(eng, "PROMPT", {
      ...mkOpts(svc, calls),
      isStopped: () => stopped,
      onCall: (c) => {
        const i = calls.findIndex((x) => x.id === c.id);
        if (i >= 0) calls[i] = { ...c };
        else calls.push({ ...c });
        if (c.status === "pending") {
          stopped = true;
          svc.discardPending("msg1");
        }
      },
    });
    expect(r.status).toBe("partial");
    expect(calls[0].status).toBe("denied");
    expect(calls[0].error).toBe("stopped");
  });
});
