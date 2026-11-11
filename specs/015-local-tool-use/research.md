# Research: Sandboxed Local Tool Use

All spec clarifications resolved; remaining unknowns were design-level
mechanisms, decided below against the current codebase (post-016 main).

## D1 — Pause/approve/resume mechanism

**Decision**: stop-and-continue loop. When a complete ````tool_call`
block is detected in the streamed output, `engine.stop()` ends the in-flight
`generate()` (status `partial` internally — not the user's stop path).
After approval + execution, a *new* `generate()` call is issued whose
prompt is `originalPrompt + generatedSoFar + tool_result block`.

**Rationale**: `lls_generate_continue` already verifies the token prefix
against resident KV and falls back to a full decode on any mismatch —
correctness is guaranteed in C. The tool-result text prefills only the
unmatched suffix, so the common path stays warm. No shim changes.

**Alternatives considered**: (a) blocking `onToken` — impossible, it's a
sync callback inside the decode loop; (b) a pause gate inside `generate()` —
can't inject text into an in-flight decode anyway, so a stop is mandatory
regardless; keeping the loop at the `run()` level is simpler and reuses
existing partial/stop handling.

## D2 — Where the tool loop lives

**Decision**: a `runToolLoop` driver in `src/bun/tools/loop.ts` wraps a
single "generate once" call. `streamAssistant`'s inner generate site and
`fusion.ts`'s `genPhase` (executor only) call it instead of calling
`engine.generate` directly. It is a no-op passthrough when tools are
inactive (deny mode or no sandboxRoot) — zero behavior change otherwise.

**Rationale**: one implementation serves single + fusion paths; the
executor-only rule (FR-009) is enforced structurally by only wiring the
loop into the executor phase.

## D3 — Tool-call detection

**Decision**: `src/shared/tool-call.ts` — a pure parser shared by bun and
renderer. Scans accumulated text for ````tool_call` fenced blocks,
extracts `{tool, path}` JSON, validates against the two known tools.
Malformed blocks produce a typed `malformed` verdict, never execute, and
still consume one budget slot.

**Rationale**: spec-agents' contract pattern — validate model output into
a typed record before anything executes. Sharing the parser lets the
renderer locate block spans for card rendering without a second grammar.

## D4 — Sandbox enforcement

**Decision**: `src/bun/tools/sandbox.ts`. `sandboxRoot` is canonicalized
once (`realpathSync`); each call resolves `path` (relative → join root;
absolute → as-is), `realpathSync`s it, and requires `resolved === root ||
resolved.startsWith(root + sep)`. Out-of-root → `refused` verdict before
any prompt or I/O. Non-existent in-root targets are tool *errors*
(fed back to the model), not refusals.

**Rationale**: realpath defeats `..` and symlink escapes — the
spec-agents `LEGAL_ALLOWED_ROOTS` equivalent.

## D5 — Approval plumbing

**Decision**: bun-side deferred promise. Emitting `tool.update` with
`status: "pending"` precedes the await; a new `tool.respond` request
resolves it (`approve` | `deny` | `allowSession`). `allowSession` sets a
per-conversation in-memory grant (Map keyed conversationId inside the
tool service; cleared on restart — nothing persisted).

While a call is pending the engine is *not* generating
(`lls_generate_end` ran), so `engine.isGenerating()` is false — the
turn-level `activeMessageId` becomes the ENGINE_BUSY gate for
send/regenerate/edit during the pause. `chat.stop` during a pending call
resolves the deferred as discarded → turn ends `partial`.

## D6 — Tool result representation

**Decision**: after execution the turn appends a fenced ````tool_result`
block (JSON: `{status, content}` — content truncated per D7) to the
assistant's raw stream, and generation continues after it. The
`tool_result` text is injected into the continuation prompt verbatim so
the model reads it; it also persists in `message.content` so history
replays it naturally on later turns.

**Rationale**: single assistant message per turn; blocks render as cards
while prose renders normally; no second prompt-turn type needed.

## D7 — Result sizing

**Decision**: tool result content is capped at **8 KiB** before injection,
with a `\n…[truncated]` marker appended. The injected block is charged
against the normal buildPrompt budget via `costOf` like any other text —
the existing budget-halving retry handles overflow.

**Rationale**: FR-007 requires budgeting + a marker; 8 KiB ≈ 2k tokens is
a sane bound for small contexts and keeps `list_dir` on large dirs usable.

## D8 — Cap counting

**Decision**: the per-turn budget counts *detected* calls (executed,
denied, refused, or malformed) — max 5. At the 5th consumed slot, a
````tool_result` "tool budget exhausted" block is injected, and the
parser disarms: any further blocks in that turn render as inert cards
(verdict `refused`, reason `budget`) without pausing generation.

**Rationale**: counting malformed calls prevents a garbage-block loop
from spinning forever; disarming (vs. stopping) lets the model finish
its prose gracefully.

## D9 — Settings & activation

**Decision**: `settings.tools?: { sandboxRoot: string | null; mode:
"ask" | "allow-read-session" | "deny" }` — global, persisted via the
existing settings JSON. Tools are *active* iff `sandboxRoot` is set and
`mode !== "deny"`; only then is the `tool_call` instruction injected
(FR-012). `tool.pickRoot` reuses the injected `dialogs.pickFolder` for a
native folder picker; mode + root edit via settings.set extension.

**Rationale**: deny/unset ⇒ prompts byte-identical to pre-feature
(SC-004); the picker path follows the attachments precedent (injectable
dialog for headless tests).

## D10 — Persistence & audit

**Decision**: `message.toolCalls?: ToolCallRecord[]` persisted in the
conversation JSON (id, tool, requested path, resolved path, status,
result summary, ts). Additionally every *executed* call appends one line
to `dataDir()/tool-audit.jsonl` — survives conversation deletion.

**Rationale**: message records power inline cards and reload; the JSONL
satisfies FR-011's audit requirement independent of UI state.

## D11 — spec-agents mapping (reference only)

Confirmed: `spec-agents`/`legal-saas` is a Python/Pydantic/LiteLLM
framework — not linkable into the single-binary Bun/FFI app. Its patterns
map as: `Component.compute()` → deterministic main-process executors;
frontmatter contracts → D3's typed parser; `FabricError` → typed verdicts;
`LEGAL_ALLOWED_ROOTS` → D4; audit rows → D10 JSONL; budgeted agent runs →
per-turn cap of 5. No dependency taken.
