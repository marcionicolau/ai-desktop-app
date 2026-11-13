# Research: Python & R Script Calling

Spec clarifications resolved (persistent sessions, pipelines in scope,
benchmark-gated mechanism). Remaining unknowns were design mechanisms,
decided below against the current codebase (post-PR-#36 main).

## D1 — Backend abstraction first, mechanism second

**Decision**: every caller (tool loop, manual run, pipeline step) talks
to `SessionManager` → `ScriptBackend` — a small typed contract
(`ensure` / `call` / `reset` / `status` / `dispose` per runtime). Two
implementations satisfy it: `subprocess.ts` and `embedded.ts`. A
settings/backend selector picks the impl; default `auto` resolves to
the benchmark winner.

**Rationale**: FR-024 requires identical semantics behind both
mechanisms — the contract boundary is the only way to guarantee it.
Callers never know which backend serves a call.

**Alternatives considered**: (a) hard-coding subprocess — abandons the
FR-022 benchmark mandate; (b) FFI-first — abandons crash isolation
before it's measured.

## D2 — Mechanism (b): supervised child-process session

**Decision**: `Bun.spawn` per runtime, started lazily on first call:
`python3 -u runners/python_runner.py` / `Rscript runners/r_runner.R`.
Protocol is newline-delimited JSON on stdio: host writes
`{"id", "code", "args", "cwd"}`, runner replies `{"id", "ok",
"result"|"error", "stdout", "stderr", "files"}`. The runner `exec`s
code into a module-level namespace dict (Python) or `eval`s into a
persistent `environment()` (R) — that namespace **is** the session;
state survives calls with zero extra machinery.

**Lifecycle**: reset = `kill()` + respawn (cheap, total). Timeout =
host-side timer → `SIGTERM` → `SIGKILL`; partial output still returned.
Crash = process exit mid-call → next call respawns; the run result
carries `sessionRestarted: true` (FR-020). Serialization = a promise
queue per runtime inside `SessionManager` (FR-019) — the runner itself
is single-threaded by construction.

**Rationale**: crash containment is structural — a segfault in numpy or
an R C extension kills the child, never the app. No native build, no
libpython/libR discovery, works with any interpreter the user points
at (venvs included, just a path).

**Alternatives considered**: Jupyter kernel protocol (ZMQ — heavy dep,
violates VI); `python -i` REPL scraping (fragile output boundaries);
`Rserve` (external package requirement).

## D3 — Mechanism (a): FFI-embedded interpreter

**Decision**: prototype — a dedicated `Bun Worker` per runtime owns the
embedded session so FFI calls don't block the main event loop (unlike
`lls_step`'s per-token calls, a whole-script eval is unbounded).
Python: `dlopen(libpython)` + C API — `Py_InitializeFromConfig`,
`PyGILState_Ensure`, `PyRun_SimpleString`; stdout captured by injecting
`sys.stdout`/`sys.stderr` redirect to an in-memory buffer at init (pure
bun:ffi, no C shim needed for Python). R: `libR` needs SEXP
manipulation (`R_ParseVector` → `R_tryEval`) — not tractable through
raw FFI pointer calls, so a vendored `script_shim.c` (same pattern as
`llama_shim.c`) wraps init/eval/output-capture via `WriteConsoleEx`.

**Known limitation (documented, not assumed)**: upstream R cannot be
re-initialized in one process — `Rf_endEmbeddedR` + re-init produces
"bad target context--should NEVER happen" (r-devel, bug #12644). So
embedded R **cannot satisfy FR-018 reset or FR-020 crash-restart**
without respawning the host. The benchmark records this as a
crash-containment finding; expected outcome is either per-runtime
mechanism split (Python embedded, R subprocess) or subprocess wins
outright. Python's `Py_FinalizeEx`/`Py_Initialize` re-init works for
pure Python but leaks state in C-extension modules (documented caveat,
measured in the benchmark).

**Rationale**: this is the mechanism the user's references point at
(bun_python, cffi, rpy2) — worth prototyping because per-call latency
and zero-copy potential are real advantages if containment passes.

**Alternatives considered**: calling libR purely through bun:ffi
(SEXPREC construction needs real C); Pyodide/WASM Python (sandboxed
but can't reach user site-packages — rejected by the spec's
user-provided-interpreters assumption).

## D4 — Benchmark design (FR-022/FR-023)

**Decision**: `scripts/bench-script-backends.ts` — a repo script that
drives both backends through the same `ScriptBackend` contract with a
fixed workload matrix per available runtime: cold start; warm
single-call latency (median p50/p95 over N=50 trivial calls); sustained
state-accumulating sequence (validates state fidelity); large-output
call (~1 MiB); RSS of host + child/worker after workloads; forced
fault (`ctypes` segfault / `tools:::.Rd_get_section` abort path) —
records whether the host survives (the decisive crash-containment
metric); plus an artifact-presence check for packaging feasibility.
Output: `specs/023-python-r-scripts/benchmark.md` table + raw JSON.

**Rationale**: FR-023 enumerates the metrics; a scripted harness makes
the comparison reproducible by reviewers instead of anecdotal.

## D5 — Registry & source storage

**Decision**: `dataDir()/scripts.json` holds the registry array; source
lives in `dataDir()/scripts/<slug>.py|.R` (stored copies — deleting the
original file can't break an entry). `ScriptStore` follows the
`json-store` pattern used by personas/snippets. Slug = kebab name,
enforced unique (FR-001).

**Alternatives considered**: settings.json (entry sources are files —
file storage is honest); external file refs only (spec's
source-reference edge case wants graceful behavior, stored copies make
it moot for stored-source entries; external-path entries stay
supported and degrade to source-unavailable).

## D6 — Policy surface

**Decision**: `settings.scripts: { mode: "ask" | "allow-session" |
"deny", runtimes: { python: {path}, r: {path} }, backend?: "auto" |
"subprocess" | "embedded" }`. Separate from `settings.tools` — scripts
are not read-only and don't need `sandboxRoot` to be active. Session
grants reuse the ToolService pattern but live in ScriptService keyed
by conversationId (or run id for pipelines); `allow-session` means
"auto-approve script calls in this conversation", stored in memory
only.

**Rationale**: spec FR-005 says "same policy modes", not same settings
blob — a distinct block keeps script activation independent of the fs
sandbox root while reusing the exact grant/deferral machinery.

## D7 — Tool-call grammar extension

**Decision**: `parseCallBody` gains a `run_script` arm:
`{"tool":"run_script","script":"<name>","args":{...}}` (args optional;
omitted → raw text arg for paramless scripts). The verdict pipeline in
`runToolLoop` gets a parallel branch: parse → script policy active? →
registry lookup (missing/disabled → refused `unknown-script`) → param
validation → pending decision → backend call → `tool_result` injection.
Budget, cap, fusion executor-only, audit all reuse the existing
path — `ToolCallRecord` gains `script?`/`args?`/`exitStatus?` fields.

**Rationale**: smallest possible delta — one more tool name in the same
grammar rather than a parallel script_call fence; the model learns one
convention.

## D8 — Prompt injection

**Decision**: when script policy is active, the tool instruction block
appends a script section: each enabled script's name, description, and
declared params (name/type/required) so the model can emit valid
`run_script` args. `deny`/unset → prompt byte-identical (same gate
shape as FR-012 in spec 015).

## D9 — Confinement & files (FR-016/FR-017)

**Decision**: each *call* gets `dataDir()/script-runs/<runId>/` as cwd
(created per call, listed after, attachable). Env passed to the child
is explicit (`PATH`, `HOME`, `LANG`, `TMPDIR`, interpreter-specific
vars) — never `process.env` wholesale. Interpreter inheritances like
site-packages are the user's install doing what it was installed to
do — confinement covers cwd/env, not the language's own module system.
Files written outside the run dir are outside our boundary (documented
assumption: scripts are user-trusted).

## D10 — Pipeline integration (FR-021)

**Decision**: new skill runtime `runtime: "script"` with frontmatter
`script: <name>`; ports map to script args; the skill's declared
`outputs` are parsed from captured stdout/JSON result. Registered only
when the pack declares capability `scripts.run` (added to
`CAPABILITIES`). Execution calls `ScriptService.call` with the run id
as the consent namespace — pending decisions surface through the same
`tool.update`/`tool.respond` path, keyed by run, so a pipeline step
pauses for approval exactly like a chat call. Unresolved script name →
step fails `SCRIPT_NOT_FOUND` (mapped to FabricError CONTRACT_VIOLATION
at validation, runtime error at run).

**Alternatives considered**: `component:script.run` builtin — rejected:
a builtin would bake script binding into the registry without the
consent/audit context that `runSkill` provides; a dedicated runtime is
honest about its external side effects.

## D11 — Surfaces

**Decision**: `surfaceId` gains `"scripts"`; `features/scripts/` holds
the library page (list + runtime health badges), editor (name, runtime,
source editor or file import, params table, timeout), and RunForm
(manual run + result). Timeline: `ToolCallCard` renders a run_script
variant — script name, args summary, status, duration, output preview,
produced-files list. Settings gains a Scripts section (mode, per-runtime
interpreter path + auto-detected status, backend selector, reset
buttons per runtime).

## D12 — Mechanism rollout

**Decision**: `backend: "auto"` default → subprocess until the
benchmark artifact says otherwise; `"embedded"` is selectable only in
dev builds until the packaging check passes for it (Resources staging,
lib discovery per-platform). Whichever loses remains merged but
non-default — it is the documented alternative FR-022 preserves.
