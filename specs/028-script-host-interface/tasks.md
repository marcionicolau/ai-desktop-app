# Tasks: Script Host Interface (feature 028)

**Spec**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Contracts**:
[abi.md](contracts/abi.md) · [protocol.md](contracts/protocol.md)

Delivery follows research §8: suite+ABI → Python host → R module → switch +
cleanup. Linux-only first release; `bun test ./tests` must stay green.

## Phase 1: Setup

- [ ] T001 Create `src/native/script-host/` skeleton: `CMakeLists.txt`
  building `cz-host` + `libcz_python` unconditionally and `libcz_r` only when
  `R_INCLUDE_DIR`+`R_LIBRARY` are found (fixes D7 — Python never gated on R);
  wire into `native/build/<platform>` flow used by `bun run build:native`.
- [ ] T002 Update `src/shared/types.ts`: `ScriptBackendKind` →
  `"auto" | "host" | "subprocess"`; extend `ScriptCallResult`-adjacent types
  with `outcome`, `contentSha256`, `method`, `methodReason`; `AuditEntry`
  gains `method` + `methodReason` (per data-model.md).

## Phase 2: Foundational

- [ ] T003 Write `src/native/script-host/cz_script.h` exactly per
  `contracts/abi.md` (CZ_ABI_VERSION 1, cz_ctx/cz_result, cz_request fields
  verbatim incl. `expected_sha256` + `limits`, cz_outcome enum, all
  cz_result_* accessors, module obligations in comments).
- [ ] T004 Change the `ScriptBackend` contract in
  `src/bun/scripts/backend.ts`: `ScriptCallRequest.code` → `path` +
  `expectedFingerprint?` + `limits?`; `ScriptCallResult` gains `outcome`,
  `contentSha256`, `error{type,message,traceback,file,line}`, `method`,
  `methodReason`; `kind` → `"subprocess" | "host"`. Update
  `backends/subprocess.ts` to hash `path` bytes itself (keeps the fallback
  fingerprint-parity) and `service.ts`/`session.ts` call sites to pass the
  file path + `approvedFingerprint`. Update all existing tests that build
  requests.
- [ ] T005 Implement `src/native/script-host/cz-host.c` core: `dlopen` the
  module passed via `--module`, `dlsym` the ABI, emit the ready line
  `{"protocol":1,"abi":1,"language":…,"ready":true}` (protocol.md), then a
  read-line/dispatch loop calling `cz_run_file` and serializing the result
  accessors to JSON (built in C — no external deps). Reject module/ABI
  mismatch at start-up with a nonzero exit + message (FR-009).

## Phase 3: US1 — scripts run from their file, in place (P1)

**Independent test**: run `err.py`/`ok.py`/`state.py` via the Python host —
real file+line in errors, sibling import works, `__file__` set, session
state persists, `content_sha256` reported; `expected_sha256` mismatch →
`content_changed`, missing file → `source_missing`.

- [ ] T006 [US1] Implement `src/native/script-host/modules/python.c`:
  header-free `dlopen(libpython)` using the `LIBDIR`/`INSTSONAME` probe
  (E4), `PyInitConfig_Create` + `SetInt("isolated",1)` + `executable` +
  `Py_InitializeFromInitConfig`; bootstrap defining run-by-path
  (`runpy`/compile with real filename, script dir on `sys.path`,
  `__file__`); structured error (type/message/traceback/file/line).
- [ ] T007 [US1] python.c: sha256 the file bytes at run time; on
  `expected_sha256` mismatch return `CZ_CONTENT_CHANGED` before executing
  (FR-005, SC-006); missing/unreadable → `CZ_SOURCE_MISSING` (FR-006);
  return `content_sha256` on every run (FR-004).
- [ ] T008 [P] [US1] Bun-side unit test `tests/scripts/host-backend.test.ts`
  scaffolding: fake `cz-host` (small TS script spawned over pipes) that
  speaks protocol v1 — used by T016's backend before real modules land.

## Phase 4: US2 — one interface, one module per language (P1)

**Independent test**: build without R headers → `libcz_python` still
builds+works; start host with a module reporting the wrong ABI → clean
mismatch error, no runs.

- [ ] T009 [US2] cz-host.c start-up validation: `cz_abi_version()` ≠
  `CZ_ABI_VERSION` or missing symbols → exit with explicit message; ready
  line carries `abi` so Bun can gate too (FR-009).
- [ ] T010 [P] [US2] CMake: prove decoupling — `libcz_python` target needs
  only libdl; `libcz_r` links `libR` and is `OPTIONAL`/absent without R
  (SC-007); record both build paths in `quickstart.md` §1.

## Phase 5: US3 — faults and runaways never take the app down (P1)

**Independent test**: crash/loop/memory scripts each leave the app alive;
interrupt ≤100 ms; forced stop after 2 s grace; 0 hosts after app kill.

- [ ] T011 [US3] cz-host.c limits + signals: `RLIMIT_AS` (mem_bytes, 0 =
  unlimited default) + `RLIMIT_CPU` before run; `PR_SET_PDEATHSIG`;
  `SIGINT` → `cz_interrupt()`; run scripts in a process-group-aware way so
  the Bun side can signal the group; fd 1/2 capture pipes → merged into
  `stdout`/`stderr` fields with `output_bytes` truncation + `truncated`
  marker (FR-012/015).
- [ ] T012 [US3] `src/bun/scripts/backends/host.ts`: spawn `cz-host`
  (`--module`, `--interpreter`, `--lib`), ready-line handshake + version
  gate, serialized NDJSON calls, timeout at `req.timeoutMs`, cancel →
  `SIGINT`, 2 s grace → `SIGTERM` process group → `SIGKILL`, dead pipe /
  host exit mid-run → `host_fault` + session dead + respawn on next
  `ensure()` (SC-002); `dispose()` kills all hosts (FR-013).
- [ ] T013 [P] [US3] tests: `tests/scripts/host-backend.test.ts` — using
  the T008 fake host: cancel≤100 ms, grace escalation, host crash →
  `host_fault` + respawn, output truncation, `content_changed`/`source_missing`
  outcomes mapped, `dispose()` leaves no process.

## Phase 6: US4 — same quality of result in both languages (P2)

**Independent test**: equivalent .py/.R scripts produce identically-shaped
results; R runs need no optional packages.

- [ ] T014 [US4] Implement `src/native/script-host/modules/r.c`:
  `Rf_initEmbeddedR` on host main thread (return 1 = success — D5 fix),
  `R_SignalHandlers=0`, `source(path, keep.source=TRUE)` in
  `tryCatch`/`withCallingHandlers`, `srcref` → file:line, JSON in C (no
  `jsonlite` — FR-016), `R_interrupts_pending` on `cz_interrupt`.

## Phase 7: US5 — user's own environments + safe fallback (P2)

**Independent test**: venv-only package imports under host; Python <3.14 or
no `libpython.so` → subprocess fallback with recorded reason, one-time
notice; `backend:"host"` pin works.

- [ ] T015 [US5] `src/bun/scripts/runtimes.ts`: probe interpreter once for
  `sysconfig` `LIBDIR`/`INSTSONAME` + version ≥3.14 → `hostUsable` flag +
  reason (`"python-3.11"`, `"no-libpython"`, …); R usable iff `libcz_r`
  module + `libR` present.
- [ ] T016 [US5] Wire `backends/host.ts` into `session.ts` backend selection:
  `"auto"` → host when `hostUsable` else subprocess; `"host"`/`"subprocess"`
  pin; stored `embedded` migrates to `auto` (settings load shim);
  `BackendUnavailable` from host → automatic subprocess retry per FR-019,
  `method`/`methodReason` recorded on the result and audited, one-time
  fallback notice via existing toast/event path.
- [ ] T017 [P] [US5] `tests/scripts/host-fallback.test.ts`: each fallback
  reason → subprocess used + `methodReason` recorded; pinned `"host"` with
  unusable interpreter → clear error (not silent); migration of stored
  `"embedded"` → `auto`.

## Phase 8: US6 — conformance suite + benchmark (P3)

**Independent test**: suite passes for both modules and catches a broken
module; bench numbers recorded next to 023's.

- [ ] T018 [US6] `tests/conformance/suite.ts`: language-neutral battery per
  SC-009 — run by path, result shape, state, cancel, mem limit, crash
  containment + respawn, fingerprint, `content_changed`, `source_missing`,
  venv import (Python); `--broken` mode must fail.
- [ ] T019 [P] [US6] `tests/conformance/bench.ts`: startup, first-call,
  warm p50/p95 per module; write
  `specs/028-script-host-interface/benchmark.md` beside 023's figures.

## Phase 9: Polish & removal

- [ ] T020 Remove `src/native/shim/script_shim.c` (+ CMake target),
  `src/bun/scripts/backends/embedded.ts`, `embedded-worker.ts`, and the
  `embedded` enum remnants; update `scripts/stage-native.ts` to stage
  `cz-host` + `libcz_*` beside the llama shim (FR-023).
- [ ] T021 [P] Update `AGENTS.md` — replace the embedded-backend paragraph
  with the host architecture (ABI, modules, protocol, fallback).
- [ ] T022 Gates: `bun run typecheck`, `bun run lint`,
  `bun test ./tests` (existing suite unchanged — SC-010),
  `bun run build:renderer`, native build clean.
- [ ] T023 Walkthrough `quickstart.md` §1–§6 end-to-end; record results.

## Dependencies

```text
Setup (T001–T002)
  └─ Foundational (T003 ABI → T004 contract → T005 host core)
       ├─ US1 Python module (T006–T008) ── US2 validation (T009–T010)
       ├─ US3 host.ts + limits (T011–T013)  [needs T005]
       ├─ US4 R module (T014)               [needs T005]
       └─ US5 wiring/fallback (T015–T017)   [needs T004 + T012]
            └─ US6 suite/bench (T018–T019) → Polish (T020–T023)
```

MVP = T001–T009 (Python scripts running from files via host). US4/US5 can
parallelize after T012.

## Parallel opportunities

- T008 (fake host test) ∥ T006–T007 (module work) — different files.
- T010 (CMake proof) ∥ T009 (host validation).
- T013 (backend tests) ∥ T012 implementation tail.
- T014 (R module) ∥ T015–T016 (Bun wiring) — no shared files.
- T019 (bench) ∥ T020–T021 (removal/docs).
