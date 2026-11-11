// Pure prompt assembly: history budgeting + template formatting.
// Extracted from rpc/handlers.ts so it can be unit-tested without RPC
// fixtures and shared by the KV-continue path (US2).

export interface PromptTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface PromptResult {
  prompt: string;
  turns: PromptTurn[];
  truncated: boolean;
}

export interface BuildPromptOpts {
  chatml: boolean;
  // max cost units the rendered turn list may occupy (tokens when costOf
  // is supplied, else chars — the caller still retries on real overflow)
  budget: number;
  // per-turn cost; default is a chars/4-ish heuristic
  costOf?: (t: PromptTurn) => number;
  // feature 006: persona system prompt — always kept, charged against the
  // budget before history; hard-truncated if it alone overflows
  system?: string;
}

const OVERHEAD_CHARS = 32; // per-turn template wrapper estimate
const defaultCost = (t: PromptTurn) => t.content.length + OVERHEAD_CHARS;

// feature 015: tool-use instruction injected only when the tool policy
// is active (FR-012) — deny mode leaves prompts byte-identical
export const TOOL_INSTRUCTIONS = `You may request read-only filesystem access inside the user's sandbox by emitting exactly one fenced block per request:

\`\`\`tool_call
{"tool":"read_file","path":"<path inside the sandbox>"}
\`\`\`

Tools: "read_file" (returns file contents) and "list_dir" (returns entry names, "/" suffix for directories). After the block, stop writing — the result arrives in a \`\`\`tool_result\`\`\` block, then continue your answer. Do not emit more than one block per reply.`;

// persona system prompt + tool instructions share the system slot
export function composeSystem(
  persona: string | undefined,
  toolsActive: boolean,
): string | undefined {
  const parts = [persona, toolsActive ? TOOL_INSTRUCTIONS : null].filter(
    (p): p is string => !!p,
  );
  return parts.length ? parts.join("\n\n") : undefined;
}

// history is newest-first (most recent turn at index 0); the current user
// message is always kept. Oldest turns are dropped when over budget.
export function buildPrompt(
  history: PromptTurn[],
  current: string,
  opts: BuildPromptOpts,
): PromptResult {
  const costOf = opts.costOf ?? defaultCost;
  const cur: PromptTurn = { role: "user", content: current };
  const sel: PromptTurn[] = [cur];
  let used = costOf(cur);
  let truncated = false;
  // charge the system turn first (it always wins over history), then
  // prepend it after selection so order is [system, oldest..newest, cur]
  let sysTurn: PromptTurn | null = null;
  if (opts.system) {
    const unit = costOf({ role: "system", content: "" });
    const room = Math.max(0, opts.budget - used - unit);
    const content =
      opts.system.length > room ? opts.system.slice(0, room) : opts.system;
    if (content.length < opts.system.length) truncated = true;
    sysTurn = { role: "system", content };
    used += unit + content.length;
  }
  for (const t of history) {
    const cost = costOf(t);
    if (used + cost > opts.budget) {
      truncated = true;
      break;
    }
    used += cost;
    sel.unshift(t);
  }
  if (sysTurn) sel.unshift(sysTurn);
  return { prompt: render(sel, opts.chatml), turns: sel, truncated };
}

export function render(turns: PromptTurn[], chatml: boolean): string {
  // oxlint-disable-next-line no-useless-concat -- kept split: tooling strips the literal token
  const open = "<" + "|im_start|>";
  // oxlint-disable-next-line no-useless-concat -- kept split: tooling strips the literal token
  const close = "<" + "|im_end|>";
  const LABEL: Record<PromptTurn["role"], string> = {
    system: "System: ",
    user: "User: ",
    assistant: "Assistant: ",
  };
  return chatml
    ? turns.map((t) => open + t.role + "\n" + t.content + close + "\n").join("") +
        open + "assistant\n"
    : turns.map((t) => LABEL[t.role] + t.content + "\n").join("") + "Assistant: ";
}
