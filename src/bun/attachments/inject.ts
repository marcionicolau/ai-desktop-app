// Prompt injection for attachments (feature 009). File blocks are
// prepended to the user turn — since buildPrompt always keeps `current`
// and budgets history around it, attachments are included ahead of
// history truncation (FR-004).
import type { MessageAttachment } from "../../shared/types";
import type { StoredAttachment } from "./store";

export interface FitResult {
  // text to prepend to the user's message inside the same turn
  injectText: string;
  // per-attachment status records (attach order)
  records: MessageAttachment[];
  // human-readable warnings for chat.warning, one per affected file
  warnings: string[];
}

const block = (a: StoredAttachment, content: string): string =>
  `<file name="${a.fileName}" size="${a.sizeBytes}">\n${content}\n</file>\n\n`;

const TRUNC_MARKER = "\n… [truncated]";

// chars/4 token heuristic, consistent with prompt.ts defaultCost
const cost = (s: string) => Math.ceil(s.length / 4);

// truncate content at a line boundary to fit `charBudget`, appending
// the marker. Returns "" if nothing meaningful fits.
function truncateTo(content: string, charBudget: number): string {
  if (charBudget <= 0) return "";
  const cut = content.slice(0, Math.max(0, charBudget - TRUNC_MARKER.length));
  const lastNl = cut.lastIndexOf("\n");
  const trimmed = lastNl > cut.length * 0.5 ? cut.slice(0, lastNl) : cut;
  return trimmed + TRUNC_MARKER;
}

// include attachments in attach order until `budget` (cost units) is
// spent. First non-fitting file is truncated at a line boundary; files
// after it are excluded (D2).
export function fitBudget(
  atts: StoredAttachment[],
  userContent: string,
  budget: number,
): FitResult {
  let remaining = budget - cost(userContent);
  let injectText = "";
  const records: MessageAttachment[] = [];
  const warnings: string[] = [];

  for (const a of atts) {
    if (remaining <= 0) {
      records.push({ id: a.id, fileName: a.fileName, sizeBytes: a.sizeBytes, status: "excluded" });
      warnings.push(`${a.fileName} excluded — context budget spent`);
      continue;
    }
    const full = block(a, a.content);
    if (cost(full) <= remaining) {
      injectText += full;
      remaining -= cost(full);
      records.push({ id: a.id, fileName: a.fileName, sizeBytes: a.sizeBytes, status: "full" });
      continue;
    }
    // doesn't fit: truncate at a line boundary within remaining budget
    const overhead = cost(block(a, "")) + cost(TRUNC_MARKER);
    const charBudget = remaining * 4 - overhead * 4;
    const part = truncateTo(a.content, charBudget);
    if (part.length > 0) {
      const b = block(a, part);
      injectText += b;
      remaining -= cost(b);
      records.push({ id: a.id, fileName: a.fileName, sizeBytes: a.sizeBytes, status: "truncated" });
      warnings.push(`${a.fileName} truncated to fit context`);
    } else {
      records.push({ id: a.id, fileName: a.fileName, sizeBytes: a.sizeBytes, status: "excluded" });
      warnings.push(`${a.fileName} excluded — context budget spent`);
    }
  }
  return { injectText, records, warnings };
}

// one-line summary for the fusion planner phase (FR-008, D4)
export function plannerSummary(atts: StoredAttachment[]): string {
  if (atts.length === 0) return "";
  const items = atts.map(
    (a) => `${a.fileName} (${(a.sizeBytes / 1024).toFixed(1)} KB)`,
  );
  return `Attached files: ${items.join(", ")}`;
}
