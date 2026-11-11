import { describe, expect, test } from "bun:test";
import {
  firstCallBlock,
  hasOpenCallFence,
  parseCallBody,
  renderResultBlock,
  scanBlocks,
} from "../../src/shared/tool-call";

describe("scanBlocks", () => {
  test("extracts a tool_call block and ignores surrounding prose", () => {
    const text =
      'Let me check.\n```tool_call\n{"tool":"read_file","path":"a.txt"}\n```\nDone.';
    const blocks = scanBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].fence).toBe("tool_call");
    expect(blocks[0].body).toBe('{"tool":"read_file","path":"a.txt"}');
    expect(text.slice(0, blocks[0].start)).toBe("Let me check.\n");
    expect(text.slice(blocks[0].end)).toBe("\nDone.");
  });

  test("finds multiple blocks including tool_result", () => {
    const text =
      'a\n```tool_call\n{"tool":"list_dir","path":"."}\n```\nb\n' +
      '```tool_result\n{"status":"ok","content":"x"}\n```\nc';
    const blocks = scanBlocks(text);
    expect(blocks.map((b) => b.fence)).toEqual(["tool_call", "tool_result"]);
  });

  test("no blocks in plain text", () => {
    expect(scanBlocks("just prose with ```code``` fences")).toEqual([]);
  });
});

describe("firstCallBlock / hasOpenCallFence", () => {
  test("returns first complete call block only", () => {
    const text = '```tool_call\n{"tool":"read_file","path":"x"}\n```';
    expect(firstCallBlock(text)?.body).toContain("read_file");
    expect(firstCallBlock("no fence")).toBeNull();
    // open but unclosed fence is not a complete block
    expect(firstCallBlock('```tool_call\n{"tool":"read_file"')).toBeNull();
  });

  test("detects an open unclosed call fence", () => {
    expect(hasOpenCallFence("text ```tool_call\n{\"tool\":")).toBe(true);
    expect(
      hasOpenCallFence('```tool_call\n{}\n```\nmore'),
    ).toBe(false);
    expect(hasOpenCallFence("no fence")).toBe(false);
  });
});

describe("parseCallBody", () => {
  test("valid call", () => {
    expect(parseCallBody('{"tool":"read_file","path":"a.txt"}')).toEqual({
      ok: true,
      tool: "read_file",
      path: "a.txt",
    });
  });

  test("rejects invalid JSON", () => {
    const r = parseCallBody("{not json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed");
  });

  test("rejects non-object payloads", () => {
    for (const body of ["[1]", '"x"', "42", "null"]) {
      expect(parseCallBody(body).ok).toBe(false);
    }
  });

  test("rejects unknown tool names", () => {
    const r = parseCallBody('{"tool":"write_file","path":"a"}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain("write_file");
  });

  test("rejects missing/empty/non-string path", () => {
    for (const body of [
      '{"tool":"read_file"}',
      '{"tool":"read_file","path":"  "}',
      '{"tool":"read_file","path":7}',
    ]) {
      expect(parseCallBody(body).ok).toBe(false);
    }
  });
});

describe("renderResultBlock", () => {
  test("round-trips through scanBlocks", () => {
    const block = renderResultBlock({ status: "ok", content: "hello" });
    const [b] = scanBlocks(block);
    expect(b.fence).toBe("tool_result");
    expect(JSON.parse(b.body)).toEqual({ status: "ok", content: "hello" });
  });
});
