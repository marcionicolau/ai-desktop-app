# Quickstart: Sandboxed Local Tool Use

Validation scenarios proving the feature end-to-end. Unit-level coverage
lives in `tests/tools/` and `tests/rpc/`; this file is the manual/behavioral
gate.

## Prerequisites

- `hutch dev` running the app with a model loaded.
- A scratch sandbox dir, e.g. `~/tool-sandbox/`, containing
  `notes.txt` ("the code word is ALBATROSS") and a subdir `sub/`.
- Settings → Tools: set **sandbox root** to `~/tool-sandbox` (folder
  picker), mode **Ask each time**.

## Scenario 1 — approved read (US1, SC-001)

1. Send: "Use read_file on notes.txt and tell me the code word."
2. **Expect**: generation pauses; an inline card shows
   `read_file — notes.txt` with Approve / Deny / Allow-session buttons.
3. Approve → card flips to `executed` with a result preview; the turn
   continues and the answer contains "ALBATROSS".

## Scenario 2 — out-of-sandbox refusal (SC-002)

1. Send: "Read /etc/passwd with read_file."
2. **Expect**: if the model emits a call for `/etc/passwd`, the card
   shows `outside sandbox` **without** any Approve button; the
   model is told and answers without the data.
3. Also try `../` traversal (`../../etc/hostname`) — same refusal.

## Scenario 3 — denial feedback (US1)

1. Trigger any `read_file`, click **Deny**.
2. **Expect**: card shows `denied`; the model completes the turn
   acknowledging it can't access the file.

## Scenario 4 — session grant (US2)

1. Approve a call via **Allow reads this session**.
2. Send another prompt causing a second call.
3. **Expect**: it executes with no prompt. Switch to another
   conversation, trigger a call → prompted again (grant is
   per-conversation, in-memory).

## Scenario 5 — loop cap (SC-003, FR-008)

1. Prompt something causing repeated calls (e.g. "list the sandbox, then
   read every file you find one at a time").
2. **Expect**: at most 5 calls process; on the cap a `TOOL_BUDGET`
   warning shows, cards for later blocks show `budget exhausted`, and
   the turn completes.

## Scenario 6 — deny-all invariance (SC-004)

1. Settings → Tools → mode **Off**.
2. Send the Scenario 1 prompt again.
3. **Expect**: the model gets no tool instructions (check the metrics
   panel prompt preview, or logs) — any stray block it emits anyway is
   refused; behavior otherwise identical to before the feature.

## Scenario 7 — fusion executor-only (FR-009)

1. Switch a conversation to fusion mode; trigger a data need.
2. **Expect**: the plan phase produces its normal plan; only executor
   output can produce tool cards.

## Scenario 8 — audit + persistence (FR-011)

1. After approved executions, check `~/.ai-desktop-app/tool-audit.jsonl`
   (or `Utils.paths.userData`) — one JSON line per call with
   tool/path/verdict.
2. Reload the conversation — tool cards render in-place with verdicts.

## Automated gates

- `bun test` — incl. `tests/tools/` (parser, sandbox, loop, audit) and
  RPC-level approval/deny/stop cases.
- `bun check` (tsc) + lint + `vite build` per constitution gates.
