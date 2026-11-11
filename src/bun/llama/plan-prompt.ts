// Fusion prompt builders (research D5). The planner gets a fresh,
// history-free directive; the executor gets the normal conversation
// history plus the plan injected as a tagged block before the user turn —
// plain structured text, no schema, so small models comply.

export function buildPlannerPrompt(userText: string): string {
  return [
    "You are a planning model. Analyze the user's request and produce a",
    "concise plan: the key points to cover, a structure, and any",
    "constraints. Output ONLY the plan, at most 10 short lines - do not",
    "write the final answer.",
    "",
    `User request: ${userText}`,
  ].join("\n");
}

export function buildExecutorPrompt(userText: string, plan: string): string {
  return [
    "<plan>",
    plan.trim(),
    "</plan>",
    "",
    `Using the plan above, answer this request: ${userText}`,
  ].join("\n");
}
