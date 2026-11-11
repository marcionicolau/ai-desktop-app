// feature 015 (T024): executed calls land one JSONL line in
// APP_DATA_DIR/tool-audit.jsonl; denied/refused calls do not.
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runToolLoop, type LoopEngine } from "../../src/bun/tools/loop";
import { ToolService } from "../../src/bun/tools/service";
import { auditFile } from "../../src/bun/tools/audit";
import type { AuditEntry, Settings } from "../../src/shared/types";

const dir = mkdtempSync(join(tmpdir(), "tools-audit-"));
const data = mkdtempSync(join(tmpdir(), "tools-audit-data-"));
const CALL = (p: string) =>
  `\`\`\`tool_call\n{"tool":"read_file","path":"${p}"}\n\`\`\``;

beforeAll(() => {
  process.env.APP_DATA_DIR = data;
  writeFileSync(join(dir, "ok.txt"), "PAYLOAD");
});
afterAll(() => {
  delete process.env.APP_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
  rmSync(data, { recursive: true, force: true });
});

function loopEngine(segments: string[]): LoopEngine {
  let stopped = false;
  return {
    stop: () => {
      stopped = true;
    },
    tokenCount: (t) => t.length,
    generate: async (_p, onToken) => {
      stopped = false;
      const seg = segments.shift() ?? "ok";
      for (const ch of seg) {
        if (stopped)
          return { status: "partial", tokens: 1, elapsedMs: 1, warm: false };
        onToken(ch);
      }
      return { status: "complete", tokens: 1, elapsedMs: 1, warm: false };
    },
  };
}

const svc = (mode: "allow-read-session" | "deny") =>
  new ToolService({
    getSettings: () => ({ tools: { sandboxRoot: dir, mode } }) as Settings,
  });

const base = (service: ToolService) => ({
  tools: service,
  conversationId: "c",
  messageId: "m",
  onDelta: () => {},
  onCall: () => {},
  onBudgetWarning: () => {},
  isStopped: () => false,
});

describe("tool audit", () => {
  test("executed call writes a JSONL audit entry", async () => {
    const r = await runToolLoop(
      loopEngine([CALL("ok.txt"), " done"]),
      "P",
      base(svc("allow-read-session")),
    );
    expect(r.calls[0]?.status).toBe("executed");
    const lines = readFileSync(auditFile(), "utf-8").trim().split("\n");
    const entry = JSON.parse(lines.at(-1)!) as AuditEntry;
    expect(entry.verdict).toBe("executed");
    expect(entry.tool).toBe("read_file");
    expect(entry.resolvedPath).toBe(join(dir, "ok.txt"));
    expect(entry.resultBytes).toBeGreaterThan(0);
  });

  test("denied/refused calls write no audit line", async () => {
    const before = existsSync(auditFile())
      ? readFileSync(auditFile(), "utf-8").trim().split("\n").length
      : 0;
    await runToolLoop(
      loopEngine([CALL("../escape"), " sorry"]),
      "P",
      base(svc("allow-read-session")),
    );
    const after = readFileSync(auditFile(), "utf-8").trim().split("\n").length;
    expect(after).toBe(before); // refusal is not an execution
  });
});
