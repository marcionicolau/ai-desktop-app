# Feature Specification: Sandboxed Local Tool Use

**Feature Branch**: `015-local-tool-use`

**Created**: 2025-11-24

**Status**: Draft

**Input**: User description: "Local tool calling — the model may emit structured tool calls (read_file, list_dir within a sandboxed root) executed by the main process with user approval; results feed back into the turn with a capped iteration loop."

## Clarifications

### Session 2025-11-24

- Q: What format should the model use to emit a tool call? → A: A fenced ````tool_call` code block containing one JSON object `{"tool":"read_file"|"list_dir","path":"<sandbox-relative or absolute>"}` — at most one call per block; surrounding prose is ignored.
- Q: How should a pending tool call be presented for approval? → A: An inline card in the message timeline with Approve/Deny actions; generation pauses until the user decides.
- Q: Where do the sandbox root + approval mode live, and what scope is the session-grant? → A: `sandboxRoot` + `mode` are global settings; the read-allow grant is per-conversation and held in memory only (cleared on app restart and on conversation switch).
- Q: What should the per-turn tool-call cap be? → A: 5 tool calls per turn — hard stop with a visible notice; fixed in v1.
- Q: How should the model learn the tool-call convention? → A: The `tool_call` instruction block is injected into the prompt only when policy mode is `ask` or `allow-read-session`; `deny` mode leaves prompts untouched.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Model reads an allowed file mid-turn (Priority: P1)

While answering, the model determines it needs file content and emits a
tool call. The user is shown the request (tool + target path), approves
it, the main process executes it inside the sandbox root, and the result
is injected so the model continues and finishes its answer.

**Why this priority**: The differentiating capability — the model gains
grounded knowledge of the user's actual workspace instead of pasted
context, while the user retains control over every access.

**Independent Test**: Ask a question requiring a file's content inside
the sandbox; approve the resulting tool call; the final answer reflects
the real file.

**Acceptance Scenarios**:

1. **Given** a configured sandbox root, **When** the model emits
   `read_file` for a path inside it and the user approves, **Then** the
   result feeds back and the answer completes using real content.
2. **Given** a tool call for a path outside the sandbox root, **When**
   evaluated, **Then** it is refused outright (no prompt to approve) and
   the turn reports the refusal to the model.
3. **Given** a pending tool call, **When** the user denies it, **Then**
   the model is informed of the denial and completes its turn without
   that data.

---

### User Story 2 - Tool-call visibility & policy (Priority: P2)

Tool calls appear inline in the message timeline (tool, target, verdict,
result summary). The user configures the sandbox root and an approval
mode: ask-always, allow-read-only-for-session, or deny-all.

**Why this priority**: Transparency + control turn a risky capability
into a trusted one; per-call prompting is required for first use.

**Independent Test**: With session-allow enabled, consecutive read calls
in one conversation execute without re-prompting; a write-like or
out-of-sandbox call still refuses.

**Acceptance Scenarios**:

1. **Given** ask-always mode, **When** a tool call arrives, **Then** a
   prompt names tool + path before any execution.
2. **Given** allow-read-for-session, **When** subsequent read calls
   arrive in that conversation, **Then** they execute without prompting
   — the grant dies with the conversation's in-memory session (restart
   or switching conversations re-prompts).
3. **Given** any mode, **When** reviewing a completed turn, **Then** each
   tool call shows its verdict and a result summary.

---

### Edge Cases

- Runaway tool loops: a hard per-turn cap ends the loop with a
  user-visible notice; the model is told the budget is spent.
- Malformed tool-call output from the model: parsed conservatively;
  unparseable calls are reported as tool errors, never executed.
- Tool result larger than remaining context: truncated with a marker
  and counted against the prompt budget.
- Tool calls in fusion mode: only the executor phase may call tools;
  the planner's plan may *request* data needs but cannot execute.
- A generation stopped mid-tool-call: pending calls are discarded.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST parse structured tool calls emitted by the
  model during a turn. The emission convention is a fenced
  ````tool_call` code block containing exactly one JSON object with
  `tool` and `path` fields; text outside the block is ordinary
  assistant output, and at most one call is honored per block.
- **FR-002**: Supported v1 tools MUST be read-only filesystem tools
  (`read_file`, `list_dir`) confined to a user-configured sandbox root.
- **FR-003**: Any tool call resolving outside the sandbox root MUST be
  refused without prompting.
- **FR-004**: Tool execution MUST require user approval per call unless
  the user has granted session-scoped allow for read-only tools. A
  pending call pauses the turn and renders as an inline timeline card
  with Approve/Deny actions until the user decides.
- **FR-005**: Denied calls MUST feed a denial result back to the model so
  the turn can complete gracefully.
- **FR-006**: Tool calls and verdicts MUST render inline in the message
  timeline with tool name, target, and result summary — the same card
  carries the Approve/Deny actions while the call is pending.
- **FR-007**: Tool-result content MUST count against the prompt budget
  and be truncated with a marker when oversized.
- **FR-008**: A per-turn tool-call cap of **5** MUST exist; reaching it
  ends the loop with a visible notice and the model is told the budget
  is spent.
- **FR-009**: In fusion mode, only the executor phase MAY issue tool
  calls.
- **FR-010**: Tool calls MUST execute in the main process via typed RPC —
  never in the renderer — and MUST be fully local (no network tools in
  v1).
- **FR-011**: All tool activity MUST be auditable: each executed call is
  recorded with target and outcome.
- **FR-012**: The `tool_call` instruction block MUST be injected into
  the generation prompt only when policy mode is `ask` or
  `allow-read-session`; `deny` mode MUST leave prompts byte-identical
  to pre-feature behavior.

### Key Entities

- **Tool call**: `{ tool, args { path }, status: pending|approved|denied|
  refused|executed|error, result? }`.
- **Tool policy**: `{ sandboxRoot, mode: ask|allow-read-session|deny }`
  — global app settings; the allow-read grant is per-conversation and
  in-memory only (not persisted).
- **Tool record**: audit entry per executed call.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A question answerable only via file content completes
  correctly after one approved tool call.
- **SC-002**: 100% of out-of-sandbox path attempts are refused without
  execution.
- **SC-003**: A tool-call loop cannot exceed the configured cap under any
  model output.
- **SC-004**: With deny-all policy, the app behaves exactly as before the
  feature (zero tool executions).
- **SC-005**: All existing gates pass and no pre-existing test regresses.

## Assumptions

- v1 tools are read-only filesystem primitives; write/execute/network
  tools are explicitly out of scope.
- Tool-call detection relies on the fenced ````tool_call` JSON block
  convention, injected into the prompt only when the policy permits
  tool use; unreliable models simply never emit calls.
- The sandbox root defaults to a user-chosen directory; nothing outside
  it is ever reachable.
