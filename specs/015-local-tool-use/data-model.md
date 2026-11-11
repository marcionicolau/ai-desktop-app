# Data Model: Sandboxed Local Tool Use

## Entities

### ToolCallRecord (persisted on `Message`)

```ts
type ToolName = "read_file" | "list_dir";

type ToolCallStatus =
  | "pending"    // awaiting user decision
  | "approved"   // approved, executing (transient)
  | "denied"     // user denied
  | "refused"    // out-of-sandbox / cap-exhausted — never prompted
  | "executed"   // ran successfully
  | "error";     // malformed call or execution failure

interface ToolCallRecord {
  id: string;               // uuid; also the renderer event key
  tool: ToolName | null;    // null when the block failed schema validation
  path: string;             // as requested by the model
  resolvedPath?: string;    // canonical path when it resolved in-sandbox
  status: ToolCallStatus;
  refuseReason?: "out-of-sandbox" | "budget" | "malformed" | "disabled";
  error?: string;           // execution/parse error text
  resultPreview?: string;   // ≤200 chars, single line — card summary
  resultBytes?: number;     // post-truncation injected size
  createdAt: string;
  decidedAt?: string;       // verdict timestamp
}
```

("verdict" in spec/UX wording = the `status` field.)

`list_dir` result format: one `name` per line (`name/` for directories),
sorted; `resultPreview` = first 3 lines + total entry count.
`read_file` result = raw file text (utf-8).

`Message` gains `toolCalls?: ToolCallRecord[] | null` (optional like
`attachments`, `phases`). Raw ````tool_call` / ````tool_result` fenced
blocks remain verbatim inside `Message.content`; the renderer uses the
shared parser to split content into prose + card slots in emission order.

### ToolPolicy (persisted in `Settings`)

```ts
interface ToolPolicy {
  sandboxRoot: string | null;      // absolute path; null = tools inactive
  mode: "ask" | "allow-read-session" | "deny";
}

// Settings gains:
tools?: ToolPolicy; // undefined → {sandboxRoot: null, mode: "deny"}
```

### SessionGrant (in-memory only)

`Map<conversationId, true>` inside the tool service — set by
`tool.respond {decision:"allowSession"}` while `mode` is `ask` or
`allow-read-session`. Never persisted; cleared on restart. Conversation
switch naturally re-prompts because the grant is keyed per conversation.

### AuditEntry (JSONL, `dataDir()/tool-audit.jsonl`)

```ts
interface AuditEntry {
  ts: string;
  conversationId: string;
  messageId: string;
  callId: string;
  tool: ToolName;
  path: string;
  resolvedPath: string;
  verdict: "executed" | "error";
  resultBytes?: number;
  error?: string;
}
```

Append-only; one line per executed-or-errored call. Denied/refused calls
are already captured on the message record and don't reach the filesystem
layer, so they're excluded from the file audit by design.

## Wire types (shared)

```ts
// webview message payload — full record on every transition
"tool.update": { messageId: string; call: ToolCallRecord }

// renderer → bun decision
"tool.respond": { callId: string; decision: "approve" | "deny" | "allowSession" }
```

## Validation rules

- `path` in a call must be a non-empty string; any other schema →
  `malformed` verdict.
- `resolvedPath` is only set after the realpath containment check passes.
- Exactly one call per fenced block; multiple JSON objects → malformed.
- `tool` outside `read_file|list_dir` → `malformed`.
- Status transitions: `pending → approved|denied`; `→ refused` or
  `→ error` skip pending (no prompt). `approved → executed|error`.

## Relationships

- `Message 1..n ToolCallRecord` (order = emission order)
- `Conversation 1..1 SessionGrant` (ephemeral)
- `Settings 1..1 ToolPolicy` (global)
