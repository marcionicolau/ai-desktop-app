# RPC Contract Delta: Sandboxed Local Tool Use

Extends `src/shared/rpc-contract.ts`. Only deltas shown; existing methods
unchanged.

## bun.requests (new)

```ts
// user decision on a pending tool call; resolves the paused turn
"tool.respond": {
  params: {
    callId: string;
    decision: "approve" | "deny" | "allowSession";
  };
  // NOT_FOUND if the call isn't pending (already decided or discarded)
  response: Record<string, never>;
};

// native folder picker for the sandbox root; null = cancelled
"tool.pickRoot": {
  params: Record<string, never>;
  response: { path: string | null };
};
```

## settings.get / settings.set (extended)

```ts
// settings.get response gains:
tools: ToolPolicy; // {sandboxRoot, mode} — defaults {null, "deny"}

// settings.set params gains:
tools?: Partial<ToolPolicy>;
// sandboxRoot must be an existing directory → else INVALID_PARAMS
// mode must be one of "ask" | "allow-read-session" | "deny"
```

## webview.messages (new)

```ts
// emitted on every ToolCallRecord transition (pending → verdict) and on
// execution completion; renderer keeps a map keyed call.id
"tool.update": { messageId: string; call: ToolCallRecord };
```

## chat.warning codes (extended)

```ts
code: "CONTEXT_TRUNCATED" | "ATTACHMENTS_BUDGET" | "TOOL_BUDGET";
// TOOL_BUDGET fires once per turn when the 5-call cap is reached
```

## Behavioral notes

- `chat.send` / `chat.regenerate` / `chat.edit` return `ENGINE_BUSY`
  while a turn is paused on approval (`activeMessageId` gate, not just
  `engine.isGenerating()`).
- `chat.stop` on a turn with a pending call resolves the deferred as
  discarded; the pending record transitions to `denied` with
  `error: "stopped"` and the turn ends `partial`.
- `tool.respond` is a normal request — the awaiting turn resumes in the
  main process when it resolves.
