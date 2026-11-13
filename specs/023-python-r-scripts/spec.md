# Feature Specification: Python & R Script Calling

**Feature Branch**: `023-python-r-scripts`

**Created**: 2026-11-13

**Status**: Draft

**Input**: User description: "Criar especificação para adicionar a interface para chamada de scripts python e R no projeto, veja exemplos como: FFI in Python (blog.serghei.pl), bun_python, python-cffi-example, reticulate, rpy2"

## Clarifications

### Session 2026-11-13

- Q: Stateless per-call execution or persistent interpreter sessions? → A: Persistent sessions — one interpreter per runtime (Python, R) survives calls, so variables/imports/loaded data persist across calls like reticulate/rpy2; sessions serialize same-runtime calls and expose a user reset.
- Q: Is script invocation from extension-pack pipelines/agents in scope? → A: Yes — packs may declare script-backed pipeline steps executed through the same service, under identical consent, validation, timeout, and audit rules.
- Q: In-process FFI shim or supervised child-process sessions? → A: Both are prototyped and compared by a benchmark (latency, memory, crash containment, packaging feasibility) before the production mechanism is committed — FR-022 through FR-024.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Model invokes a registered script mid-turn (Priority: P1)

While answering, the model determines a registered Python or R script can
help (e.g., a data-analysis, transformation, or plotting script the user
has added to their library). It emits a script call naming the script and
arguments; the user is shown the request, approves it, the script executes
locally with the user's interpreter, and its result is injected back so
the model completes the turn using real output.

**Why this priority**: This is the differentiating capability — the
assistant gains the ability to run real computation beyond what a small
local model can do alone (statistics, parsing, scientific libraries),
while the user retains approval control over every execution.

**Independent Test**: Register a script that prints a computed value, ask
the model a question needing that computation, approve the resulting call,
and confirm the final answer reflects the script's real output.

**Acceptance Scenarios**:

1. **Given** a registered, enabled Python script and ask-mode consent,
   **When** the model emits a call for it and the user approves, **Then**
   the script executes with the user's Python interpreter and its output
   feeds back into the turn.
2. **Given** a registered, enabled R script, **When** the model calls it
   and the user approves, **Then** it executes with the user's R
   interpreter and its output feeds back into the turn.
3. **Given** a call for a script that does not exist or is disabled,
   **When** evaluated, **Then** it is refused without prompting and the
   model is informed of the refusal.
4. **Given** a pending script call, **When** the user denies it, **Then**
   the model is informed of the denial and completes its turn without
   executing anything.
5. **Given** a script that exits with an error, **When** it finishes,
   **Then** the failure (exit status + captured error output) is reported
   to the model as a tool result — never as an app crash.
6. **Given** a live interpreter session, **When** the model makes a second
   call to a script that reads state set by an earlier call, **Then** the
   later call sees the earlier call's variables — state persists across
   calls within the session.

---

### User Story 2 - Script library management & manual run (Priority: P2)

The user manages a personal library of scripts: create entries pointing at
a script file or stored source, assign the runtime (Python or R), declare
expected parameters, and set an optional timeout. Each entry can be run
manually from the library with a parameters form to test it before the
model ever sees it.

**Why this priority**: Registration is the substrate the model calls into,
and a manual run path lets users verify scripts safely — but the feature
delivers standalone value even before model integration is trusted.

**Independent Test**: Add a script entry with a declared parameter, run it
manually from the library with a test value, and see captured output
without opening a terminal.

**Acceptance Scenarios**:

1. **Given** the script library, **When** the user creates an entry with a
   name, runtime, and script source, **Then** it persists across app
   restarts and appears in the library list.
2. **Given** an entry with declared parameters, **When** the user runs it
   manually with values, **Then** the run shows captured output, exit
   status, and duration.
3. **Given** an entry, **When** the user edits or deletes it, **Then**
   future model and manual runs reflect the change immediately.
4. **Given** two entries with the same name, **When** the second is saved,
   **Then** it is rejected or renamed so every script name stays unique
   and unambiguous for model calls.

---

### User Story 3 - Runtime configuration & health (Priority: P3)

The user configures where Python and R interpreters live (or relies on
automatic detection), sees which runtimes are available, and gets clear
guidance when a runtime is missing — without the app failing.

**Why this priority**: Interpreter setup is per-machine and the most
common failure mode; making it visible and configurable avoids silent
breakage, but sensible auto-detection keeps it from blocking first use.

**Independent Test**: Point the Python runtime at a valid interpreter and
run a Python script; then simulate a missing R runtime and confirm R
entries show an unavailable state while Python keeps working.

**Acceptance Scenarios**:

1. **Given** interpreters installed in standard locations, **When** the
   app starts, **Then** available runtimes are detected automatically and
   shown as ready.
2. **Given** a missing R runtime, **When** viewing the library, **Then**
   R scripts show an unavailable indicator with guidance, and calls to
   them return a clear runtime-unavailable error.
3. **Given** a custom interpreter location, **When** the user sets it,
   **Then** subsequent executions use that interpreter until changed.
4. **Given** a live session with accumulated state, **When** the user
   resets the session for that runtime, **Then** the session is
   restarted and all prior variables are cleared.

---

### User Story 4 - Extension packs call scripts from pipelines (Priority: P4)

An extension pack ships a pipeline or agent whose step calls a script —
for example, an analysis pack that runs a Python step over conversation
or corpus data. The step invokes a library script through the same
execution path as chat calls, so consent, validation, timeouts, and audit
apply identically.

**Why this priority**: Pipeline integration multiplies the feature's
reach — packs can ship real computation, not just prompts — but it is a
consumption of the same service, not a new capability surface.

**Independent Test**: Install a pack whose pipeline contains a script
step, run the pipeline, and confirm the script executes under the same
approval and audit rules as a chat-initiated call.

**Acceptance Scenarios**:

1. **Given** an enabled pack declaring a script-backed pipeline step,
   **When** the pipeline runs and the call is approved, **Then** the
   script executes and its output feeds the next pipeline step.
2. **Given** a pack step referencing a script name absent from the
   library, **When** the pipeline runs, **Then** the step fails with a
   clear unresolved-script error — never silently skipped.
3. **Given** a pack run in progress, **When** policy is deny, **Then**
   script steps are refused under the same rules as chat tool calls.

---

### Edge Cases

- Interpreter missing or moved after detection: affected runtime entries
  show unavailable; calls fail with a clear error, never a crash.
- Script hangs or runs forever: a per-call timeout kills the execution;
  partial output is returned marked as timed out.
- Oversized output: captured output is truncated with a marker and counts
  against the prompt budget, matching existing tool-result handling.
- Malformed or undeclared arguments from the model: refused before
  execution with a validation error reported back to the model.
- Script file deleted or corrupted between registration and call: call
  fails with a source-unavailable error; the entry remains editable.
- Per-turn call budget: script calls share the existing per-turn tool cap
  (5); reaching it ends the loop with a visible notice.
- Fusion mode: only the executor phase may call scripts, consistent with
  existing tool behavior.
- Turn stopped mid-execution: the running script is terminated; pending
  calls are discarded; the session itself survives unless it crashed.
- Concurrent executions across tabs/runs: calls to the same runtime
  serialize through its single session — they queue rather than run in
  parallel — so state never interleaves.
- Session process dies (crash, OOM, user kill): the next call restarts
  the session; prior state loss is surfaced to the user rather than
  hidden.
- Cross-conversation state: sessions are app-wide per runtime, so state
  set in one conversation is visible to calls from another — the user
  resets a session to clear it.
- Session reset while a call is in flight: the in-flight call is
  terminated with the session and reported as interrupted.
- Scripts attempting file access outside permitted locations: confined
  to the script's working area and any user-approved paths; the model is
  never a path to unrestricted filesystem access.
- Environment hygiene: executions do not implicitly inherit sensitive
  application state; the environment passed to scripts is explicit.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST let users manage a persisted script
  library: create, edit, enable/disable, and delete entries, each with a
  unique name, a runtime (Python or R), script source, description,
  declared parameters, and an optional timeout override.
- **FR-002**: The system MUST support per-runtime interpreter
  configuration with automatic detection of interpreters in standard
  locations; a user-provided path MUST take precedence over detection.
- **FR-003**: A runtime whose interpreter is unavailable MUST surface a
  clear unavailable state in the library and cause calls for that
  runtime to fail with a runtime-unavailable error — affecting only that
  runtime's scripts.
- **FR-004**: Enabled scripts MUST be exposed to the model as callable
  tools using the existing tool-call emission convention, extended to
  carry the script name and its arguments, only when tool policy permits
  tool calls.
- **FR-005**: Every script execution invoked by the model MUST require
  user approval per call unless covered by an existing session grant,
  under the same policy modes as other tools (ask / allow-for-session /
  deny). Pending calls pause the turn and render inline with
  Approve/Deny actions.
- **FR-006**: Declared parameters MUST be validated before execution —
  wrong types, missing required values, or undeclared argument names are
  refused pre-execution and reported back to the caller. Scripts
  declaring no parameters accept a single raw text argument.
- **FR-007**: Script execution MUST run in the main process via the typed
  RPC contract — never in the renderer — and MUST be fully local.
- **FR-008**: Each execution MUST capture exit status, standard output,
  standard error, and duration; captured output MUST be capped and
  truncated with a marker when oversized, counting against the prompt
  budget like other tool results.
- **FR-009**: Each execution MUST enforce a timeout (global default with
  per-script override within a documented maximum); timed-out
  executions are terminated and their partial output is returned marked
  as timed out.
- **FR-010**: Denied calls MUST feed a denial result back to the model so
  the turn completes gracefully.
- **FR-011**: Script calls and runs MUST render inline in the message
  timeline — script name, arguments summary, status, duration, and
  output summary — reusing the existing tool-call card.
- **FR-012**: Script calls MUST share the existing per-turn tool-call cap
  and MAY only be issued by the executor phase in fusion mode.
- **FR-013**: All script executions (model- and user-initiated) MUST be
  recorded in the existing audit log with script name, argument summary,
  verdict, duration, and outcome.
- **FR-014**: Users MUST be able to run any enabled script manually from
  the library with declared-parameter inputs, and view the captured
  result — no conversation required.
- **FR-015**: Stopping a turn or cancelling a run MUST terminate the
  in-flight script process and discard pending calls.
- **FR-016**: Executions MUST be confined: each run gets a dedicated
  working area, filesystem access is limited to that area plus any
  user-approved locations, and the environment passed to the script is
  explicit — no implicit access to application internals.
- **FR-017**: Files produced by a script inside its working area MUST be
  listed in the run result and be attachable to the conversation.
- **FR-018**: The system MUST run each runtime as a persistent
  interpreter session (one Python session, one R session): variables,
  imports, and loaded data survive across calls, enabling iterative
  analysis. Sessions start lazily on first use, live until app shutdown
  or explicit reset, and MUST expose a user-visible reset control that
  clears all accumulated state.
- **FR-019**: Calls to the same runtime MUST serialize through its
  session — concurrent invocations queue in order rather than executing
  in parallel, so session state never interleaves between callers.
- **FR-020**: If a session process dies, the next call MUST transparently
  restart it and the run result MUST surface that prior session state
  was lost.
- **FR-021**: Extension packs MUST be able to declare pipeline/agent
  steps that invoke library scripts through the same execution service —
  subject to identical consent policy, argument validation, timeouts,
  serialization, and audit as chat-initiated calls. A step referencing
  an unknown script name MUST fail the step with a clear
  unresolved-script error.
- **FR-022**: The production execution mechanism MUST be chosen by a
  measured comparison, not assumed: both candidate mechanisms —
  (a) in-process runtime embedding via the native boundary, and
  (b) a supervised child-process session per runtime — MUST be
  prototyped end-to-end with the same call semantics (persistent
  session, arguments in, captured results out) before the production
  implementation is committed.
- **FR-023**: The comparison benchmark MUST measure, at minimum:
  per-call round-trip latency (cold and warm), session startup cost,
  steady-state memory footprint, state fidelity across calls, and
  crash containment — whether a fatal interpreter fault terminates the
  app process. Packaged-distribution feasibility for each mechanism MUST
  be assessed. The mechanism decision and measured results MUST be
  recorded in the feature's planning artifacts.
- **FR-024**: Whichever mechanism is selected, all behavioral
  requirements in this spec (FR-001 through FR-021) MUST hold
  identically — the mechanism is interchangeable behind the same
  contract, never a different feature.

### Key Entities

- **Script**: A registered entry — unique name, runtime (Python or R),
  source reference, description, declared parameters, timeout override,
  enabled flag. The unit the model calls and the user runs.
- **Parameter**: A declared input on a script — name, type, required
  flag, description. Drives argument validation, model-call arguments,
  and the manual-run form.
- **Runtime**: An interpreter binding — kind (Python or R), configured or
  detected path, availability status. Owns which scripts can execute.
- **Script Run**: A single execution record — script, arguments,
  initiator (model, user, or pipeline step), verdict, exit status,
  duration, captured output, produced files. Feeds the timeline card
  and audit log.
- **Session**: A long-lived interpreter context for one runtime — owns
  the accumulated state (variables, imports, data) shared across calls;
  starts lazily, terminates on app shutdown or user reset.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can register a working script and see its output
  from a manual run in under 2 minutes, with no external tooling.
- **SC-002**: In a chat turn where the model calls a correct script, the
  script's real output is reflected in the assistant's final answer
  100% of the time the user approves the call.
- **SC-003**: Zero unapproved executions — under default policy, every
  model-invoked script call is shown to the user for approval before it
  runs, in 100% of cases.
- **SC-004**: A hanging or crashing script never freezes the app or the
  turn — the user sees a clear error outcome within the configured
  timeout, and can continue the conversation.
- **SC-005**: 100% of executions are auditable after the fact: script,
  initiator, verdict, and outcome are inspectable.
- **SC-006**: When a runtime is missing, affected scripts show
  unavailable within one interaction of detection, calls return clear
  errors, and the other runtime remains fully functional.
- **SC-007**: Across a multi-call turn, state set by an earlier script
  call is visible to later calls 100% of the time while the session is
  alive; after a reset, zero prior state survives.
- **SC-008**: A pipeline-invoked script call enforces identical consent,
  timeout, and audit guarantees as a chat-invoked call — no code path
  bypasses the approval or audit rules.
- **SC-009**: Both candidate execution mechanisms are exercised by the
  benchmark, and the production choice is justified by measured data —
  latency, memory, and crash containment — recorded where reviewers can
  inspect it before the mechanism is committed.

## Assumptions

- Users bring their own Python and R installations; the app detects and
  configures interpreter locations but does not download, bundle, or
  manage interpreter installations in v1.
- Scripts are user-authored or user-added and are trusted at the same
  level as the existing sandboxed tool feature — the consent prompt is
  the trust boundary, not code signing or script vetting.
- Data crosses the script boundary as declared argument values and
  captured output/files; script-side state lives inside the persistent
  session — the app exchanges arguments and results, not in-memory
  objects.
- Sessions are app-wide per runtime (not per-conversation), matching
  the reticulate/rpy2 single-session model; cross-conversation state
  visibility is a documented consequence managed via reset.
- Existing tool-use infrastructure (consent modes, per-turn cap,
  timeline cards, prompt injection, audit log) is reused rather than
  building a parallel approval system; the extension run manager
  provides the pipeline invocation path.
- Script networking, package installation, and dependency management are
  the user's responsibility — the app neither provides nor blocks them
  in v1.
- Extension packs reference script entries by name; whether packs may
  bundle and contribute their own script sources into the library is a
  planning decision, not a requirement.
- The two candidate mechanisms under evaluation are deliberately named
  but not chosen in this spec: in-process embedding (the FFI-shim style
  used by bun_python, cffi, reticulate, rpy2) and supervised
  child-process sessions. The benchmark (FR-022/FR-023) decides;
  whichever loses remains a documented alternative, not dead work.
