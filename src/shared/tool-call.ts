// feature 015: shared parser for the fenced ````tool_call` convention.
// Used by the bun-side generation loop (detection) and the renderer
// (splitting message content into prose + card slots). Pure module —
// no I/O, no dependencies.

import type { ToolName } from "./types";

export const TOOL_CALL_FENCE = "tool_call";
export const TOOL_RESULT_FENCE = "tool_result";

// a fenced block anywhere in text: ```tool_call\n{json}\n``` —
// closing fence may end the text (stream may still be open, but a
// complete block is one with a closing fence)
export interface ToolBlock {
  start: number; // offset of the opening ``` in the text
  end: number; // offset just past the closing ```
  fence: typeof TOOL_CALL_FENCE | typeof TOOL_RESULT_FENCE;
  body: string; // text between the fences, trimmed
}

export type ParsedCall =
  | { ok: true; tool: ToolName; path: string }
  | { ok: false; reason: "malformed"; detail: string };

const BLOCK_RE =
  /```(tool_call|tool_result)\s*\r?\n([\s\S]*?)```/g;

// every complete fenced tool block in `text`, in order
export function scanBlocks(text: string): ToolBlock[] {
  const out: ToolBlock[] = [];
  BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_RE.exec(text)) !== null) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      fence: m[1] as ToolBlock["fence"],
      body: m[2]!.trim(),
    });
  }
  return out;
}

// first complete tool_call block in `text`, or null
export function firstCallBlock(text: string): ToolBlock | null {
  return scanBlocks(text).find((b) => b.fence === TOOL_CALL_FENCE) ?? null;
}

// true while `text` contains an opening ```tool_call fence with no
// closing fence yet — the loop keeps streaming until it closes
export function hasOpenCallFence(text: string): boolean {
  const open = text.lastIndexOf("```" + TOOL_CALL_FENCE);
  if (open < 0) return false;
  return !text.includes("```", open + 3 + TOOL_CALL_FENCE.length);
}

// validate one block body → typed call or malformed verdict
export function parseCallBody(body: string): ParsedCall {
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch {
    return { ok: false, reason: "malformed", detail: "invalid JSON" };
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return { ok: false, reason: "malformed", detail: "payload is not an object" };
  }
  const o = v as Record<string, unknown>;
  const tool = o.tool;
  if (tool !== "read_file" && tool !== "list_dir") {
    return {
      ok: false,
      reason: "malformed",
      detail: `unknown tool: ${String(tool)}`,
    };
  }
  const path = o.path;
  if (typeof path !== "string" || path.trim() === "") {
    return { ok: false, reason: "malformed", detail: "path must be a non-empty string" };
  }
  // exactly one call object — extra keys are tolerated but a second
  // top-level object/array would already have failed JSON.parse
  return { ok: true, tool, path: path.trim() };
}

// serialize a tool result block for injection into the stream/prompt
export function renderResultBlock(payload: {
  status: "ok" | "denied" | "refused" | "error";
  content: string;
}): string {
  return "```" + TOOL_RESULT_FENCE + "\n" + JSON.stringify(payload) + "\n```\n";
}
