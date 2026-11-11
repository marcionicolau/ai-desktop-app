// feature 015: deterministic tool executors (research D6/D7). The
// model never computes — these functions do. Results are capped at
// RESULT_CAP bytes before injection; oversized output gets a marker.
import { readFileSync, readdirSync, statSync } from "node:fs";
import type { ToolName } from "../../shared/types";

export const RESULT_CAP = 8 * 1024; // 8 KiB

export interface ToolResult {
  ok: boolean;
  content: string; // possibly truncated with marker
  truncated: boolean;
  bytes: number; // post-truncation byte size of `content`
  error?: string;
}

const truncate = (s: string): ToolResult => {
  const buf = Buffer.from(s, "utf-8");
  if (buf.byteLength <= RESULT_CAP) {
    return { ok: true, content: s, truncated: false, bytes: buf.byteLength };
  }
  // cut at cap, then back off to a UTF-8 boundary (continuation bytes
  // are 0b10xxxxxx) so the slice decodes cleanly
  let end = RESULT_CAP;
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--;
  const content = buf.subarray(0, end).toString("utf-8") + "\n…[truncated]";
  return { ok: true, content, truncated: true, bytes: Buffer.byteLength(content) };
};

const isBinary = (buf: Buffer): boolean => buf.includes(0);

export function runTool(
  tool: ToolName,
  resolvedPath: string,
): ToolResult {
  try {
    if (tool === "read_file") {
      const buf = readFileSync(resolvedPath);
      if (isBinary(buf)) {
        return {
          ok: false,
          content: "",
          truncated: false,
          bytes: 0,
          error: "binary file — cannot read as text",
        };
      }
      return truncate(buf.toString("utf-8"));
    }
    // list_dir: one `name` per line, `name/` for directories, sorted
    const entries = readdirSync(resolvedPath)
      .map((n) => (statSync(`${resolvedPath}/${n}`).isDirectory() ? `${n}/` : n))
      .toSorted();
    return truncate(entries.join("\n"));
  } catch (e) {
    return {
      ok: false,
      content: "",
      truncated: false,
      bytes: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
