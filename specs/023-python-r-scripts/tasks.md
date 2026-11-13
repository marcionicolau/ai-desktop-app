---

description: "Task list for feature 023 — Python & R script calling"
---

# Tasks: Python & R Script Calling

**Input**: Design documents from `/specs/023-python-r-scripts/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included — every execution path in this repo carries a `bun test` suite (spec-015 precedent); test tasks are marked per phase.

**Organization**: Tasks are grouped by user story (US1 P1 → US4 P4) for independent implementation and testing. The FR-022 mechanism benchmark is a foundational gate, sequenced inside Phase 2 as parallel prototype work.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)

---

## Phase 1: Setup

**Purpose**: shared types and contract surface every other task compiles against

- [ ] T001 Add script types to src/shared/types.ts — `ScriptEntry` (id slug, runtime `"python"|"r"`, source `{kind:"stored"}|{kind:"external",path}`, description, `params: ScriptParam[]`, `timeoutMs?`, `enabled`), `ScriptParam` (name, type `"text"|"number"|"json"|"bool"`, required, description), `SessionState` (`"cold"|"starting"|"live"|"dead"`), `ScriptRunRecord` (runId, script, args, initiator `"model"|"user"|"pipeline"`, verdict, exitStatus, stdout/stderr, durationMs, files, sessionRestarted), `ScriptPolicy` + `Settings.scripts` block, `RuntimeStatus`; extend `ToolCallRecord` with `script?`/`args?`/`exitStatus?`/`durationMs?`/`files?` and `ToolName` union with `"run_script"`
- [ ] T002 [P] Add RPC surface to src/shared/rpc-contract.ts — methods `script.list`, `script.upsert`, `script.delete`, `script.run`, `script.enable`, `runtime.list`, `runtime.detect`, `runtime.reset`; events `script.run` and `session.state`; `surfaceId` union gains `"scripts"`; error codes `SCRIPT_NOT_FOUND`, `SCRIPT_INVALID_ARGS`, `SCRIPT_TIMEOUT`, `RUNTIME_NOT_FOUND`, `SESSION_DEAD`
- [ ] T003 [P] Add `"scripts.run"` to `CAPABILITIES` in src/shared/pack-schema.ts

---

## Phase 2: Foundational

**Purpose**: the ScriptBackend contract, the subprocess implementation (default mechanism), session machinery, the registry — plus the mechanism-(a) prototype and benchmark gate (FR-022/023). All user stories sit on top of this.

- [ ] T004 [P] Implement ScriptStore in src/bun/scripts/store.ts — `dataDir()/scripts.json` registry CRUD + source files under `dataDir()/scripts/<slug>.<ext>` (stored kind) and external-path entries, slug uniqueness per data-model.md, following the json-store pattern used by personas
- [ ] T005 [P] Define the ScriptBackend contract in src/bun/scripts/backend.ts — `ensure`/`call`/`reset`/`status`/`dispose` per contracts/backend.md, shared `ScriptCallRequest`/`ScriptCallResult` types
- [ ] T006 [P] Write session runners src/bun/scripts/runners/python_runner.py and src/bun/scripts/runners/r_runner.R — NDJSON stdio protocol per backend.md (`{id,code,args,cwd}` → `{id,ok,result|error,stdout,stderr,files}`), Python `exec` into a module-level namespace dict, R `eval` into a persistent environment — the persistent namespace IS the session (research D2)
- [ ] T007 Implement subprocess backend in src/bun/scripts/backends/subprocess.ts — `Bun.spawn` lazy start, NDJSON write/read, per-call `dataDir()/script-runs/<runId>/` cwd, explicit env allowlist (`PATH`, `HOME`, `LANG`, `TMPDIR` + interpreter vars — never `process.env` wholesale), produced-file listing, process-exit → dead-session detection (research D2/D9)
- [ ] T008 Implement SessionManager in src/bun/scripts/session.ts — lazy `ensure`, per-runtime promise-queue serialization (FR-019), host-side timeout (SIGTERM → SIGKILL, partial output returned), crash → `sessionRestarted` flag on next call (FR-020), `reset()` (FR-018), status/restartCount tracking
- [ ] T009 [P] Implement runtime detection in src/bun/scripts/runtimes.ts — resolve `python3`/`python` and `Rscript` via PATH lookup plus `which`-style probing; user-configured `settings.scripts.runtimes.*.path` takes precedence; expose `{kind, configuredPath, detectedPath, status:"ready"|"missing"}` (FR-002/FR-003)
- [ ] T010 Implement ScriptService in src/bun/scripts/service.ts — CRUD over ScriptStore, script policy (`settings.scripts.mode`), per-conversation/per-run session grants mirroring ToolService's grant/deferral pattern (in-memory only), declared-param validation (types, required, extras → invalid-args), workdir lifecycle, `initiator` plumbing, audit-field plumbing to recordAudit
- [ ] T011 [P] Prototype embedded backend in src/bun/scripts/backends/embedded.ts + src/bun/scripts/embedded-worker.ts — a `Worker` per runtime owns the FFI session (FFI is synchronous; the llama engine stays responsive only because calls are per-token), `dlopen` libpython + `Py_InitializeFromConfig`/`PyGILState_Ensure`/`PyRun_SimpleString`, stdout/stderr captured via injected sys stream redirect — Python only (research D3)
- [ ] T012 [P] Prototype R embedding shim in src/native/shim/script_shim.c — wraps `Rf_initEmbeddedR`/`R_ParseVector`/`R_tryEval` + `WriteConsoleEx` capture, same build pattern as `llama_shim.c`; record in notes that upstream R cannot re-init in-process (benchmark measures it — research D3)
- [ ] T013 Build the benchmark harness scripts/bench-script-backends.ts — drives both backends through the ScriptBackend contract with the workload matrix in contracts/backend.md (cold start, warm p50/p95 ×50, state-accumulating sequence, ~1 MiB output, RSS, forced fault → host survival, packaging check); writes `specs/023-python-r-scripts/benchmark.md` (table + raw JSON)
- [ ] T014 [P] Write tests/scripts/store.test.ts — slug uniqueness, stored/external sources, delete cascade, persistence round-trip
- [ ] T015 [P] Write tests/scripts/session.test.ts — lazy start, serialization ordering, timeout → partial output, crash → restarted flag, reset clears state (fake backend)
- [ ] T016 [P] Write tests/scripts/service.test.ts — policy modes, session grants per conversation, param validation accept/reject matrix, initiator + audit plumbing

---

## Phase 3: User Story 1 — Model invokes a registered script mid-turn (P1)

**Goal**: the model emits `run_script` inside the existing ````tool_call` convention; consent, validation, execution, and `tool_result` injection all flow through the existing loop (spec US1, FR-004/005/006/008/010/011/012/013/015)

**Independent test**: register `add-one` with param `input_value:number`, ask the model to run it on 41, approve the pending card → answer uses `42` (quickstart S2)

- [ ] T017 [US1] Extend src/shared/tool-call.ts `parseCallBody` — `run_script` arm accepting `{"tool":"run_script","script":"<id>","args":{...}}` plus `"input"` raw-text form for paramless scripts, per contracts/tool-call.md; unknown/malformed stays `malformed`
- [ ] T018 [US1] Add the run_script verdict branch to src/bun/tools/loop.ts — order per contracts/tool-call.md: parse → policy inactive (`disabled`) → registry miss/disabled (`unknown-script`) → arg validation (`invalid-args`) → pending decision (tool.update/tool.respond) → SessionManager call → `tool_result` injection including `session restarted — prior state lost` on `sessionRestarted`; shares the existing per-turn budget of 5 and inert-card disarm path
- [ ] T019 [US1] Extend src/bun/llama/prompt.ts — script section in the tool instruction block listing each enabled script's name, description, and declared params (`name:type(req)` form) when script policy is active; `deny` mode leaves prompts byte-identical
- [ ] T020 [US1] Wire run_script into src/bun/rpc/handlers.ts generate path — ScriptService + SessionManager injection into the tool loop, `tool.respond` reuse for pending script decisions, `chat.stop` termination of in-flight script + discard of pending calls (FR-015)
- [ ] T021 [US1] Extend audit in src/bun/tools/audit.ts — record `script`, `initiator`, `exitStatus`, `durationMs`, `sessionRestarted` fields for `run_script` lines per data-model.md
- [ ] T022 [P] [US1] Add the run_script variant to src/renderer/src/features/tools/ToolCallCard.tsx — script name, args summary, status, duration, output preview, produced-files list
- [ ] T023 [US1] Write tests/tools run_script cases — parser arm (valid/invalid), loop verdict ordering (disabled, unknown-script, invalid-args, denied, executed, timeout), budget sharing with file tools, deny-mode prompt byte-identical
- [ ] T024 [US1] Write tests/scripts/end-to-end case — fixture script + fake session + loop → tool_result carries script output into continuation prompt

**Checkpoint**: model-initiated script calls work end-to-end with consent + audit; manual run UI may not exist yet (register via test fixtures/handler)

---

## Phase 4: User Story 2 — Script library management & manual run (P2)

**Goal**: users create/edit/run/delete script entries from a library surface; manual runs bypass consent but share everything else (spec US2, FR-001/014/017)

**Independent test**: create `add-one` in the library, run it manually with `input_value=41`, see `42` — no conversation involved (quickstart S1)

- [ ] T025 [US2] Implement script.* CRUD handlers in src/bun/rpc/handlers.ts — `script.list`, `script.upsert` (slug from name, uniqueness → INVALID_PARAMS, stored-source write, external-path validation), `script.delete` (entry + stored source removal; in-flight calls finish on snapshot), `script.enable`
- [ ] T026 [US2] Implement `script.run` handler + `script.run` progress event in src/bun/rpc/handlers.ts — manual runs skip the consent prompt (initiator `"user"`) but share validation/timeout/workdir/capture; emits `queued|running|done|error` phases per contracts/rpc.md
- [ ] T027 [P] [US2] Create src/renderer/src/features/scripts/use-scripts.ts — RPC hooks for list/upsert/delete/run + `script.run` event subscription
- [ ] T028 [US2] Create src/renderer/src/features/scripts/ScriptsPage.tsx — library list with name, runtime badge + health, enabled toggle, description; empty state
- [ ] T029 [US2] Create src/renderer/src/features/scripts/ScriptEditor.tsx — name, runtime select (python/r), source editor or file import, params table (name/type/required/description), timeout override field
- [ ] T030 [US2] Create src/renderer/src/features/scripts/RunForm.tsx — declared-params input form, run button, captured result view (stdout/stderr/exit/duration), produced-files list with attach action
- [ ] T031 [US2] Register the `"scripts"` surface in src/renderer/src/features/workspace/tab-model.ts (follows personas/models wiring)
- [ ] T032 [US2] Write tests/rpc script.* handler cases — upsert validation, slug collision, delete cascade, manual-run result shape, source-unavailable for missing external paths

**Checkpoint**: library is fully usable standalone — user can register, run, and iterate on scripts with zero model involvement

---

## Phase 5: User Story 3 — Runtime configuration & health (P3)

**Goal**: per-runtime interpreter config with auto-detection, health surfaces, and session reset (spec US3, FR-002/003/018/020)

**Independent test**: point Python at a valid interpreter → python runs work; simulate missing Rscript → R entries badge `missing` and calls error `runtime-unavailable` while Python is unaffected (quickstart S4)

- [ ] T033 [US3] Implement runtime.* handlers in src/bun/rpc/handlers.ts — `runtime.list` (configuredPath, detectedPath, status, session state/restartCount), `runtime.detect`, `runtime.reset` (kills session; in-flight call → `interrupted` verdict)
- [ ] T034 [US3] Wire `session.state` event emission in src/bun/scripts/session.ts — emit on cold→starting→live→dead transitions and restartCount bumps so badges update live
- [ ] T035 [US3] Create src/renderer/src/features/settings/ScriptsSettings.tsx — policy mode select (ask/allow-session/deny), per-runtime interpreter path field + auto-detect button + status badge, backend selector (auto/subprocess/embedded), per-runtime session reset buttons with state display
- [ ] T036 [US3] Surface runtime health on ScriptsPage — per-runtime status badge row fed by `session.state` + `runtime.list` (missing interpreter → entries marked unavailable)
- [ ] T037 [US3] Write tests/scripts runtime cases — detection precedence (user path > detected), missing-runtime refusal, reset while in-flight → interrupted, session.state event sequence

**Checkpoint**: interpreters configurable, health visible, sessions resettable — all three runtimes states demonstrated

---

## Phase 6: User Story 4 — Extension packs call scripts from pipelines (P4)

**Goal**: `runtime: "script"` skills invoke library scripts inside pack runs under identical consent/audit rules (spec US4, FR-021)

**Independent test**: enable a fixture pack with a script skill + `scripts.run` capability, run its pipeline, approve the pending call, step output feeds the next step (quickstart S6)

- [ ] T038 [US4] Extend src/bun/fabric/frontmatter.ts — accept `runtime: "script"` on non-pipeline skills with required `script: <slug>` field; validate the script reference shape (resolution to library entries is run-time, not load-time)
- [ ] T039 [US4] Extend pack validation in src/bun/fabric/frontmatter.ts and src/bun/extensions/store.ts — a pack containing script skills must declare capability `scripts.run`; enable fails without it (CAPABILITY_DENIED-class error at validation per contracts/pack-script.md)
- [ ] T040 [US4] Implement the script skill branch in src/bun/fabric/components.ts `runSkill` — bind ports→args, call ScriptService with initiator `"pipeline"` and the run id as consent namespace; JSON-parse stdout into declared outputs (fallback `{output: stdout}`); unresolved script → `SCRIPT_NOT_FOUND` step failure (FabricError)
- [ ] T041 [US4] Plumb ScriptService + pending-decision path into the run context in src/bun/fabric/runtime.ts (or RunCtx assembly site) — run-scoped consent grants (allow-session within one run), pending decision surfaced via tool.update keyed by run id, abort → terminate in-flight call + discard pending
- [ ] T042 [US4] Write tests/fabric script-skill cases — frontmatter accepts/rejects, capability gate at enable, pipeline run executes script step, missing script fails located, deny policy refuses step

**Checkpoint**: extension packs can ship real computation; every story now independently functional

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: benchmark decision, production default, validation sweep

- [ ] T043 Run `bun scripts/bench-script-backends.ts` on the dev box; write specs/023-python-r-scripts/benchmark.md; apply the selection rule from contracts/backend.md (crash containment hard-gates; then latency/memory; ties → subprocess) and set the `"auto"` default accordingly in src/bun/scripts/service.ts
- [ ] T044 Decide the embedded path's shipping status — if selected, extend scripts/stage-native.ts + artifact verification for libpython/libR discovery; if not, keep the prototype dev-gated (backend `"embedded"` rejected in packaged builds) and record the decision in benchmark.md
- [ ] T045 Verify deny-mode prompt parity — snapshot test in tests/llama/plan-prompt.test.ts (or a new tests/llama/prompt.test.ts) asserting the injected block is absent/byte-identical when `settings.scripts.mode === "deny"` (mirrors FR-012 precedent)
- [ ] T046 Walk quickstart.md scenarios S1–S7 against the dev app with real python3 (+ Rscript where available); file follow-ups for anything off-spec
- [ ] T047 Update AGENTS.md with the scripts feature entry (surfaces, settings key, audit file, runner location)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: no dependencies — T001 must land before T002/T003 consumers compile, but all three are independent files
- **Phase 2 (Foundational)**: depends on Phase 1 types — **BLOCKS all user stories**
  - T004/T005/T006 in parallel → T007 (needs runner + contract) → T008 (needs backend) → T010 (needs store + session + runtimes)
  - T011/T012 (mechanism-(a) prototypes) parallel with T007–T010 — only T013 needs them
  - T014–T016 after their units
- **Phases 3–6 (US1–US4)**: all depend on Phase 2; US2's `script.*` handlers technically feed US1's registration but fixtures can seed the store — stories remain independently testable
- **Phase 7**: after all story phases

### User Story Dependencies

- **US1 (P1)**: no story deps — the MVP slice
- **US2 (P2)**: shares ScriptService/store with US1, independently testable
- **US3 (P3)**: shares runtimes/session with both, independently testable
- **US4 (P4)**: consumes service + consent machinery; independently testable via fixture pack

### Parallel Opportunities

- T001 ‖ T002 ‖ T003 (Setup)
- T004 ‖ T005 ‖ T006; T011 ‖ T012 (prototypes) — Phase 2's two tracks
- T022 (renderer card) parallel with T017–T021 (US1)
- T027–T030 renderer files parallel once T026's handler shape is known (US2)
- US3 and US4 phases are nearly disjoint files — parallel-friendly

---

## Implementation Strategy

### MVP First (US1 only)

1. Phase 1 + Phase 2 (incl. prototype track) → backend machinery + benchmark harness ready
2. Phase 3 (US1) → model calls scripts with consent — the differentiating value
3. **STOP and VALIDATE**: quickstart S2 + tests green → demoable

### Incremental Delivery

US1 (MVP) → US2 (library UI makes it usable without fixtures) → US3 (runtime ops polish) → US4 (pack reach) → Phase 7 (benchmark decision + validation)

### Benchmark Gate Note

The FR-022 gate doesn't block story work — `subprocess` is the working
default throughout, and T043 flips `"auto"` only if the benchmark
earns it. Embedded-R's known re-init limitation (research D3) means the
likely outcomes are "subprocess wins" or "per-runtime split" — the
benchmark artifact decides with numbers.
