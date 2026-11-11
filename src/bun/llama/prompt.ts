// Pure prompt assembly: history budgeting + template formatting.
// Extracted from rpc/handlers.ts so it can be unit-tested without RPC
// fixtures and shared by the KV-continue path (US2).

export interface PromptTurn {
  role: "user" | "assistant";
  content: string;
}

export interface PromptResult {
  prompt: string;
  turns: PromptTurn[];
  truncated: boolean;
}

export interface BuildPromptOpts {
  chatml: boolean;
  // max characters the rendered turn list may occupy (heuristic budget;
  // the caller still retries on real token-level overflow)
  budgetChars: number;
}

const OVERHEAD = 32; // per-turn template wrapper estimate

// history is newest-first (most recent turn at index 0); the current user
// message is always kept. Oldest turns are dropped when over budget.
export function buildPrompt(
  history: PromptTurn[],
  current: string,
  opts: BuildPromptOpts,
): PromptResult {
  const sel: PromptTurn[] = [{ role: "user", content: current }];
  let used = current.length + OVERHEAD;
  let truncated = false;
  for (const t of history) {
    const cost = t.content.length + OVERHEAD;
    if (used + cost > opts.budgetChars) {
      truncated = true;
      break;
    }
    used += cost;
    sel.unshift(t);
  }
  return { prompt: render(sel, opts.chatml), turns: sel, truncated };
}

export function render(turns: PromptTurn[], chatml: boolean): string {
  const open = "<" + "|im_start|>";
  const close = "<" + "|im_end|>";
  return chatml
    ? turns.map((t) => open + t.role + "\n" + t.content + close + "\n").join("") +
        open + "assistant\n"
    : turns
        .map(
          (t) =>
            (t.role === "user" ? "User: " : "Assistant: ") + t.content + "\n",
        )
        .join("") + "Assistant: ";
}
