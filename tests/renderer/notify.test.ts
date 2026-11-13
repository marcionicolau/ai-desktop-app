import { describe, expect, test } from "bun:test";
import { isValidElement, type ReactElement } from "react";
import { createNotify, MAX_DESC, SUCCESS_MS, type ToastSink } from "../../src/renderer/src/lib/notify";

// records every sink call so the policy (durations, persistence, in-place
// progress updates, recovery actions) can be asserted without a DOM

function fakeSink() {
  const calls: { kind: string; message?: string; opts?: Record<string, unknown> }[] = [];
  const mk = (kind: string) => (message: string, opts?: Record<string, unknown>) => {
    calls.push({ kind, message, opts });
    return calls.length;
  };
  const sink = {
    success: mk("success"),
    error: mk("error"),
    info: mk("info"),
    warning: mk("warning"),
    loading: mk("loading"),
    dismiss: (id?: string | number) => void calls.push({ kind: "dismiss", opts: { id } }),
  } as unknown as ToastSink;
  return { sink, calls };
}

describe("notify policy", () => {
  test("success auto-dismisses after SUCCESS_MS", () => {
    const { sink, calls } = fakeSink();
    createNotify(sink).success("Saved");
    expect(calls[0]).toMatchObject({ kind: "success", message: "Saved" });
    expect(calls[0]!.opts!.duration).toBe(SUCCESS_MS);
  });

  test("error persists and maps the recovery action to onClick", () => {
    const { sink, calls } = fakeSink();
    let retried = 0;
    createNotify(sink).error("Download failed", {
      description: "Connection lost",
      action: { label: "Retry", run: () => retried++ },
    });
    const o = calls[0]!.opts as { duration: number; description: string; action: { label: string; onClick: () => void } };
    expect(o.duration).toBe(Infinity);
    expect(o.description).toBe("Connection lost");
    expect(o.action.label).toBe("Retry");
    o.action.onClick();
    expect(retried).toBe(1);
  });

  test("progress updates one toast in place and settles on done", () => {
    const { sink, calls } = fakeSink();
    const p = createNotify(sink).progress("dl-1", "Downloading model");
    p.update(42.4);
    p.update(180); // clamped
    p.done("Model ready");
    expect(calls.map((c) => c.kind)).toEqual(["loading", "loading", "loading", "success"]);
    expect(calls.every((c) => c.opts!.id === "dl-1")).toBe(true);
    expect(calls[1]!.opts!.description).toBe("42%");
    expect(calls[2]!.opts!.description).toBe("100%");
  });

  test("progress failure becomes a persistent error with the same id", () => {
    const { sink, calls } = fakeSink();
    const p = createNotify(sink).progress("dl-2", "Downloading");
    p.fail("Download failed", { action: { label: "Retry", run: () => {} } });
    expect(calls[1]).toMatchObject({ kind: "error" });
    expect(calls[1]!.opts!.id).toBe("dl-2");
    expect(calls[1]!.opts!.duration).toBe(Infinity);
  });

  test("a long description is clamped with the full text on the title", () => {
    const { sink, calls } = fakeSink();
    const long = "x".repeat(MAX_DESC + 50);
    createNotify(sink).error("Import failed", { description: long });
    const d = calls[0]!.opts!.description;
    expect(isValidElement(d)).toBe(true);
    const el = d as ReactElement<{ title: string; className: string; children: string }>;
    expect(el.props.title).toBe(long);
    expect(el.props.children).toBe(long);
    expect(el.props.className).toContain("line-clamp");
  });

  test("several notices are independent calls (stacking is the host's job)", () => {
    const { sink, calls } = fakeSink();
    const n = createNotify(sink);
    n.success("a");
    n.error("b");
    n.info("c");
    expect(calls.map((c) => c.kind)).toEqual(["success", "error", "info"]);
  });
});
