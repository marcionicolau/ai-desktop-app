import { describe, expect, test } from "bun:test";
import { ToolService } from "../../src/bun/tools/service";
import type { Settings } from "../../src/shared/types";
import { DEFAULT_GENERATION } from "../../src/shared/types";
import { tmpdir } from "node:os";

const mkSettings = (tools?: Settings["tools"]): Settings => ({
  activeModelPath: null,
  contextLimitWarning: true,
  generation: DEFAULT_GENERATION,
  modelOverrides: {},
  tags: [],
  tools,
});

const svc = (tools?: Settings["tools"]) =>
  new ToolService({ getSettings: () => mkSettings(tools) });

describe("ToolService policy/active", () => {
  test("unset tools -> deny, inactive", () => {
    const s = svc();
    expect(s.policy()).toEqual({ sandboxRoot: null, mode: "deny" });
    expect(s.active()).toBe(false);
    expect(s.sandbox()).toBeNull();
  });

  test("deny mode with root -> inactive", () => {
    const s = svc({ sandboxRoot: tmpdir(), mode: "deny" });
    expect(s.active()).toBe(false);
  });

  test("ask mode with existing root -> active + sandbox", () => {
    const s = svc({ sandboxRoot: tmpdir(), mode: "ask" });
    expect(s.active()).toBe(true);
    expect(s.sandbox()).not.toBeNull();
  });

  test("nonexistent root -> sandbox() null", () => {
    const s = svc({ sandboxRoot: "/definitely/not/here", mode: "ask" });
    expect(s.active()).toBe(true); // policy allows…
    expect(s.sandbox()).toBeNull(); // …but the sandbox can't be built
  });
});

describe("session grants", () => {
  test("grant is keyed per conversation, never persisted", () => {
    const s = svc({ sandboxRoot: tmpdir(), mode: "ask" });
    expect(s.autoApprove("c1")).toBe(false);
    s.grantSession("c1");
    expect(s.autoApprove("c1")).toBe(true);
    expect(s.autoApprove("c2")).toBe(false);
    // a new service instance (restart) holds no grants
    expect(svc({ sandboxRoot: tmpdir(), mode: "ask" }).autoApprove("c1")).toBe(
      false,
    );
  });

  test("allow-read-session mode auto-approves everywhere", () => {
    const s = svc({ sandboxRoot: tmpdir(), mode: "allow-read-session" });
    expect(s.autoApprove("any")).toBe(true);
  });
});

describe("pending-call deferral", () => {
  test("respond resolves the awaiting promise", async () => {
    const s = svc({ sandboxRoot: tmpdir(), mode: "ask" });
    const p = s.awaitDecision("call1", "msg1", "conv1");
    expect(s.respond("call1", "approve")).toBe(true);
    await expect(p).resolves.toBe("approve");
  });

  test("allowSession grants the pending call's conversation", async () => {
    const s = svc({ sandboxRoot: tmpdir(), mode: "ask" });
    const p = s.awaitDecision("call1", "msg1", "conv1");
    s.respond("call1", "allowSession");
    await p;
    expect(s.autoApprove("conv1")).toBe(true);
    expect(s.autoApprove("conv2")).toBe(false);
  });

  test("respond on unknown call -> false", () => {
    const s = svc();
    expect(s.respond("nope", "approve")).toBe(false);
  });

  test("discardPending resolves all pending for a message", async () => {
    const s = svc();
    const p1 = s.awaitDecision("c1", "msg1", "conv");
    const p2 = s.awaitDecision("c2", "msg2", "conv");
    s.discardPending("msg1");
    await expect(p1).resolves.toBe("discard");
    expect(s.hasPending("msg1")).toBe(false);
    expect(s.hasPending("msg2")).toBe(true);
    s.discardPending("msg2");
    await expect(p2).resolves.toBe("discard");
  });
});
