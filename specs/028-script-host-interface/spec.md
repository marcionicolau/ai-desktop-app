# Feature Specification: Script Host Interface

**Feature Branch**: `028-script-host-interface`

**Created**: 2026-11-13

**Status**: Draft

**Input**: User description: "Make an extensive research to create a new spec to improve the script_shim.c interface; split by language if necessary; the best option is to make script external files through FFI and the C interface."

**Evidence**: [research.md](research.md) — code audit of the current shim, web research, and five reproducible experiments (`experiments/`).

## Clarifications

### Session 2026-11-13

- Q: Should scripts execute inside a separate host process behind the native interface, rather than inside the app's own process via FFI? → A: Yes — a dedicated `script-host` child process per language, spoken to over the native interface; the app stays untouched by script faults.
- Q: For the first release, should the new method cover Linux only or all three platforms at once? → A: Linux only — script-host becomes the default on Linux; macOS and Windows keep the existing subprocess method until verified.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Scripts run from their file, in place (Priority: P1)

As a user who keeps Python and R scripts as files, I want a script to run directly from its file, so that errors point at the real file and line, the script can import its neighbours and find its own location, and what runs is exactly what is on disk.

**Why this priority**: Today the app reads each file itself and hands the interpreter a block of text. Errors say "script" instead of the file, relative imports and `__file__` do not work, and there is no way to be sure that the bytes the user approved are the bytes that ran. This is the core of the request.

**Independent Test**: Register a Python script that imports a sibling module and a script that raises an error three calls deep; run both → the sibling import works, and the error names the real file and the failing line.

**Acceptance Scenarios**:

1. **Given** a script file, **When** it is run, **Then** it executes from that path with its own location known to it, and a module in the same folder can be imported.
2. **Given** a script that fails, **When** the run ends, **Then** the error states the error type, the message, the file path and the line, for both Python and R.
3. **Given** a script file, **When** it is run, **Then** the run reports a fingerprint of the exact file content it executed.
4. **Given** the caller expected a specific content fingerprint (for example the one the user approved), **When** the file content differs at run time, **Then** the run is refused with a distinct "content changed" outcome and nothing executes.
5. **Given** the file is missing or unreadable, **When** a run is requested, **Then** the outcome is a distinct "source missing" result, not a generic failure.

---

### User Story 2 - One interface, one module per language (Priority: P1)

As a maintainer, I want a single native interface that Python and R each implement as a separate module, so that a missing, broken or unsupported language never affects the other, and a new language can be added without touching the existing ones.

**Why this priority**: The current prototype is one library that only builds when R's development files are present, which couples Python's availability to R's. Splitting by language was an explicit part of the request.

**Independent Test**: On a machine without R installed, build and run the Python module; on a machine without Python development files, build and run it too; remove R mid-session → Python scripts keep working.

**Acceptance Scenarios**:

1. **Given** a machine without R, **When** the product is built, **Then** the Python module builds and works.
2. **Given** a machine without Python development files, **When** the product is built, **Then** the Python module still builds and works with the interpreter installed on the machine.
3. **Given** the interface, **When** a developer reads it, **Then** it is the same for both languages and is versioned.
4. **Given** the app and a module built for a different interface version, **When** the module is started, **Then** the mismatch is detected at start-up and reported clearly instead of misbehaving.

---

### User Story 3 - Faults and runaways never take the app down (Priority: P1)

As a user, I want a script that crashes, loops forever or eats all memory to affect only that script, so that my chats and unsaved work in the app are never lost to a script.

**Why this priority**: The earlier in-app prototype died with the host on a script fault; this was the decisive reason it was rejected. Whatever replaces it must not regress on containment, and the research shows the file-based design can improve on it.

**Independent Test**: Run a script that crashes the interpreter, one that never ends, and one that allocates more memory than the limit → in all three the app stays responsive, the user sees a clear outcome, and the next script runs normally.

**Acceptance Scenarios**:

1. **Given** a script that crashes its interpreter, **When** it runs, **Then** the app keeps running, the outcome is reported as a fault, and the next run starts a fresh session.
2. **Given** a script that never finishes, **When** it is cancelled or exceeds its time limit, **Then** it is interrupted promptly and reported as interrupted or timed out, and the session stays usable when the interpreter allows it.
3. **Given** a script that ignores interruption, **When** the grace period passes, **Then** it is stopped forcibly, together with any processes it started.
4. **Given** a script that allocates more memory than the limit, **When** it runs, **Then** it ends with a normal out-of-memory error from the language, not by freezing the computer.
5. **Given** the app is closed or crashes, **When** scripts were running, **Then** no script process is left running afterwards.

---

### User Story 4 - The same quality of result in both languages (Priority: P2)

As a user, I want Python and R runs to report their outcome in the same way — success value, error, printed output, files produced, duration — without installing extra packages, so that I do not have to know which language a script used to understand the result.

**Why this priority**: The R path currently needs an extra R package just to report results, and its errors carry no location.

**Independent Test**: Run an equivalent script in each language that prints, returns a value, writes a file, and fails → the results have the same fields, and no extra R package is needed.

**Acceptance Scenarios**:

1. **Given** a Python and an R script that do the same, **When** both run, **Then** their results contain the same kinds of information, in the same shape.
2. **Given** a machine with R and no optional R packages, **When** an R script runs, **Then** it works.
3. **Given** a script that prints through the language's normal output and one that writes directly to the process's output, **When** they run, **Then** both are captured and attributed to the run.

---

### User Story 5 - Works with the user's own environments, and falls back safely (Priority: P2)

As a user with a virtual environment or a custom interpreter, I want scripts to use the interpreter I configured, with its packages, and when that is not possible I want scripts to keep working through the existing method with a clear reason.

**Why this priority**: Scripts are useful because they can use the user's own packages. A faster path that cannot see them, or that silently stops working for some installs, would be a regression.

**Independent Test**: Configure a virtual environment with a package installed only there; run a script that imports it → it works. Configure an interpreter without a shared library → scripts still run, and the app says which method it used and why.

**Acceptance Scenarios**:

1. **Given** a configured virtual environment, **When** a script imports a package installed only there, **Then** the import succeeds.
2. **Given** an interpreter that cannot be hosted (too old, no shared library, host not built), **When** a script runs, **Then** it runs through the existing method with no loss of function, and the app records which method was used and why.
3. **Given** the preferred method fails to start, **When** a script runs, **Then** the app falls back automatically and tells the user once, not on every run.

---

### User Story 6 - Verifiable by developers (Priority: P3)

As a developer, I want a conformance test suite and a benchmark that any implementation of the interface must pass, so that the Python and R modules, and any future one, can be checked against the same behaviours.

**Why this priority**: The research's results came from throw-away experiments. Keeping them as a standing suite is what stops the interface from regressing.

**Independent Test**: Run the suite against the Python module and the R module → the same cases pass; run it against a deliberately broken module → the broken behaviour is caught.

**Acceptance Scenarios**:

1. **Given** the suite, **When** it runs against a module, **Then** it checks: run by path, structured result, state across calls, cancellation, memory limit, crash containment, content fingerprint, source-missing, and a virtual environment.
2. **Given** the benchmark, **When** it runs, **Then** it reports start-up time, first-call time and warm latency per language, comparable with the figures recorded for feature 023.

---

### Edge Cases

- A script file is edited while it is running: the run uses the content read when it started.
- Script output is not valid text, or is very large: it is limited and marked as truncated, never crashing the host.
- A script starts its own child processes: cancelling or timing out stops them too.
- A script changes its working folder, or calls the language's exit function: reported as the script's own outcome, not as a host fault.
- Two interpreters of the same language are configured: each run uses the one selected for it.
- The script path contains spaces or non-ASCII characters.
- The interpreter ignores interruption inside native code: handled by the forced stop after a grace period.
- A required optional package of the language is not installed: reported as a normal script error naming the package, not as a host fault.
- The host process cannot be started at all (permissions, missing file): falls back and reports why.
- Two runs of the same language are requested at once: they are run one after the other, as today.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A script run MUST be requested by the script file's location; the language module MUST read and execute the file itself.
- **FR-002**: A running script MUST know its own location, and modules in the same folder MUST be importable, in both languages.
- **FR-003**: When a script fails, the result MUST state the error type, message, file path and line (where the language provides them) and a traceback.
- **FR-004**: Every run MUST report a content fingerprint of the exact bytes it executed.
- **FR-005**: A run request MAY carry an expected fingerprint; when the file content differs, the run MUST be refused with a distinct "content changed" outcome before any code executes.
- **FR-006**: A missing or unreadable script file MUST produce a distinct "source missing" outcome.
- **FR-007**: The native interface MUST be one language-neutral, versioned definition implemented by one separate module per language; no module may depend on another language's module or development files.
- **FR-008**: The Python module MUST build and work without the Python development files being installed, using the installed interpreter's shared library.
- **FR-009**: The modules and the interface version MUST be checked at start-up; a mismatch MUST be reported with a clear message and MUST NOT run scripts.
- **FR-010**: Scripts MUST run outside the app's own process, so that a crash, hang or memory exhaustion in a script cannot terminate the app. The isolation boundary is a dedicated `script-host` child process per language that embeds the interpreter through the native interface; the app communicates with it and is never in the fault's blast radius.
- **FR-011**: A run MUST be cancellable; cancellation MUST interrupt a running script promptly and report an "interrupted" outcome, and a forced stop, including any processes the script started, MUST follow if it does not end within a grace period.
- **FR-012**: Runs MUST be subject to limits on time, memory and output size; exceeding memory MUST end the script with the language's normal out-of-memory error, and exceeding output size MUST truncate the output and mark it.
- **FR-013**: No script process may remain after the app exits or crashes.
- **FR-014**: The result of a run MUST have the same fields for Python and R: outcome (success, error, interrupted, timed out, source missing, content changed, fault), value, error details, printed output, error output, files produced, content fingerprint, duration.
- **FR-015**: Output MUST be captured both from the language's normal output and from writes made directly to the process's output.
- **FR-016**: R scripts MUST run without requiring optional R packages beyond a base installation.
- **FR-017**: Session state (variables, imports) MUST persist across runs of the same language until the session is reset or restarted, as it does today.
- **FR-018**: Python runs MUST use the interpreter the user configured, including its virtual environment's packages.
- **FR-019**: The existing subprocess method MUST remain available as a fallback; the app MUST fall back automatically when the preferred method cannot be used (interpreter too old, no shared library, module not built or not loadable), record which method ran and why, and tell the user once.
- **FR-020**: Execution policy, consent, argument validation, timeouts, per-run folders and the audit trail from feature 023 MUST be unchanged; the audit record MUST additionally state the method used (host or fallback).
- **FR-021**: The scripts feature MUST pass its existing tests unchanged, and a shared conformance suite MUST run against every language module covering run by path, structured result, state, cancellation, memory limit, crash containment, content fingerprint, source-missing and virtual environment.
- **FR-022**: A benchmark MUST report start-up, first-call and warm latency per language, and its results MUST be recorded next to feature 023's for comparison.
- **FR-023**: The earlier in-process prototype and its worker MUST be removed once the new method is the default, so only one embedded-interpreter implementation remains. First-release platform scope is Linux only: on macOS and Windows the existing method stays in place until those platforms are verified.

### Key Entities

- **Script run request**: the script file location, arguments, optional expected content fingerprint, and limits (time, memory, output).
- **Run result**: outcome, value, error details (type, message, traceback, file, line), printed and error output, files produced, content fingerprint, duration.
- **Language module**: the implementation of the interface for one language, with its interface version and its availability (usable, missing, unsupported interpreter, version mismatch).
- **Interface version**: the identifier checked at start-up so that app and module agree.
- **Run method**: which way a script was executed (host or fallback) and, for the fallback, why.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a conformance run, 100% of script errors in both languages name the script's real file path, and a line number where the language provides one.
- **SC-002**: A script that crashes its interpreter, one that never ends, and one that exceeds the memory limit each leave the app responsive, and the next script run starts successfully within 1 second for Python and within 2 seconds for R.
- **SC-003**: A running script is interrupted within 100 ms of a cancel request, and the session remains usable afterwards for scripts that end on interruption.
- **SC-004**: Warm run latency is no worse than the feature-023 subprocess figures (0.18 ms Python, 0.8 ms R at the median) and start-up is no worse (38 ms Python, 231 ms R including first call).
- **SC-005**: After the app is closed or killed while scripts run, 0 script processes remain.
- **SC-006**: 100% of runs whose file content differs from the expected fingerprint are refused before any code executes.
- **SC-007**: The Python module builds and runs on a machine with no R and no Python development files; the R module builds only where R is available without affecting Python.
- **SC-008**: When the preferred method cannot be used, 100% of scripts still run through the fallback, and the reason is recorded.
- **SC-009**: The conformance suite passes for both language modules, and catches a deliberately broken module.
- **SC-010**: All existing quality gates pass and no existing scripts behaviour regresses.

## Assumptions

- This feature changes **how** scripts are executed and reported; consent, policy, per-run folders, audit and the user interface of feature 023 and feature 027 are unchanged. Feature 027 (scripts workspace and external files) supplies the file locations and the re-consent flow, and uses the fingerprint and the "content changed" and "source missing" outcomes defined here.
- The first release is verified on Linux; the interface is kept portable, and macOS and Windows keep the existing method until a host is verified for them.
- The host method requires Python 3.14 or newer; older interpreters, interpreters without a shared library, and any machine where the module is not built use the fallback. This is a deliberate trade-off recorded in the research.
- R runs in its own host process, so a crashed or reset R session is a new process; R's inability to be re-initialized in one process is therefore not a limitation.
- Supporting more languages is out of scope; the interface is designed so that adding one means adding one module.
- Sandboxing beyond resource limits (file-system or network confinement) is out of scope; the process boundary makes it possible later.
- The measurements in the research were taken on one machine (Fedora 44, Python 3.14.10, R 4.6.2); the success criteria are re-measured by the conformance suite and benchmark on the supported platform.
