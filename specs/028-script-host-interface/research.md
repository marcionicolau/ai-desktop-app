# Research: Script Host Interface (feature 028)

**Question asked**: improve the `script_shim.c` interface; split it by language where needed; and make scripts run **as external files through FFI and a C interface**.

**Method**: (1) audit the existing prototype and the feature-023 benchmark; (2) web research on the Python and R embedding APIs, Bun FFI, process isolation and prior art; (3) hands-on experiments on this machine (Python 3.14.10, R 4.6.2, Bun 1.4) with throw-away C hosts, kept in `experiments/` so every number below can be reproduced.

---

## 0. Summary and recommendation

1. **The wish to run scripts as external files through a C interface is right, and cheap.** A C host that is handed a *path* reads and runs the file itself, so errors carry the real file name and line, `__file__` and sibling imports work, and the file's bytes can be hashed at the moment they are executed. All of that was demonstrated (E1, E2).
2. **But the C interface should be a *process* boundary, not an in-process FFI call.** Feature 023's benchmark already showed that running the interpreter inside the app is host-fatal on a fault (exit 139) and impossible for R in a worker thread. The experiments confirm the alternative is *better on every measured axis*, not just safer: the per-language C host, driven over a pipe, has **lower warm latency than both the subprocess runners and the in-process embedding** (Python 0.11 ms vs 0.18 / 0.42 ms), contains a segfault (host dies, app survives, respawn 36–152 ms), interrupts a runaway script in under 1 ms, and enforces memory limits.
3. **Split by language: yes.** One host module per language behind one versioned C ABI (`cz_script.h`). The Python module needs **no Python headers** (proved: header-free `dlopen` + the 3.14 `PyInitConfig` API), so it can be built on machines that lack Python development files, whereas the current single `script_shim` only builds when R headers exist — coupling Python availability to R's.
4. **FFI still has a role**, but a supporting one: the same ABI can be bound with `bun:ffi` for in-process conformance tests and benchmarks (and an explicit, unsafe developer mode). It should not be the production path.
5. **Three defects in the current shim are independent of the architecture choice** and should be fixed regardless (§2): it never passes files, `Rf_initEmbeddedR`'s success value is checked wrongly, and Python is started in non-isolated mode.

Recommended architecture: **"C interface at the source level, process boundary at runtime."** §6.

---

## 1. What "script_shim.c" does today (code audit)

`src/native/shim/script_shim.c` (168 lines), `src/bun/scripts/embedded-worker.ts`, `backends/embedded.ts`, and the production `backends/subprocess.ts` + `runners/{python_runner.py,r_runner.R}`.

| # | Finding | Evidence | Consequence |
|---|---------|----------|-------------|
| D1 | **Source text, not files.** The host reads the script (stored or linked) and sends the *text*; the interpreter never sees a path. | `ScriptCallRequest.code`; `compile(tree, "<script>", …)` in both runners and the worker bootstrap | Tracebacks say `<script>`, no `__file__`, no sibling imports, the executed bytes are not tied to the file on disk (a race for any "re-consent on change" check, feature 027). |
| D2 | Python surface is two functions: init and `PyRun_SimpleString`. Results come back through a per-call JSON **file** written by Python bootstrap code, the request is base64 text spliced into an `_cz_run('…')` string. | `cz_py_exec`, `PY_BOOTSTRAP` | No structured errors at the C level (returns 0/1); output path is a side channel; string splicing as the calling convention. |
| D3 | `Py_Initialize()` (non-isolated): inherits environment variables, user site, `PYTHONPATH`. | `cz_py_init` | Behavior varies per user machine; the isolated configuration is the documented way to embed ([PyConfig docs](https://docs.python.org/3.14/c-api/init_config.html)). |
| D4 | `libpython` is found by a hard-coded candidate list, and loaded `RTLD_GLOBAL` as a workaround. | `findLibpython()` | Misses non-system interpreters and virtualenvs; asking the interpreter is the reliable way (E4). |
| D5 | **`Rf_initEmbeddedR` success is checked wrongly.** The shim treats any non-zero result as failure; the function returns **1 on success** (E2 printed `Rf_initEmbeddedR returned 1`). | `if (Rf_initEmbeddedR(3, argv) != 0) return 2;` | Even with the JIT problem solved, init would be reported as failed. The prototype could not have passed; the benchmark's `init-fatal` masked it. |
| D6 | R needs `jsonlite` plus a large R bootstrap string, with base64 and hand-rolled string escaping, and hacks for the worker thread (`R_CStackLimit = 1<<40`, JIT off). | `CZR_BOOTSTRAP`, `czr_init` | Extra R package requirement; fragile thread hacks. R is main-thread-only (§3), so the hacks only postpone the failure. |
| D7 | **One shared library for both languages**, built only if R headers+lib are found. | `CMakeLists.txt` (`if(R_INCLUDE_DIR AND R_LIBRARY)`) | On this machine Python's headers are missing and R's are present: the combination is accidental. Python embedding must not depend on R. |
| D8 | No cancellation, no limits, no fd-level capture, no versioning, no error taxonomy. A timeout means `worker.terminate()` while native code runs. | `embedded.ts` | Undefined behavior on timeout; no way to cap memory or output. |
| D9 | Faults are host-fatal. | benchmark: embedded Python `HOST DIED (exit 139)`, embedded R `exit 2` | Disqualifies in-process as the production boundary (feature 023 decision T043). |

The production subprocess path is sound but also passes text (D1) and needs `jsonlite` for R.

---

## 2. Facts that constrain any design

| Fact | Source |
|------|--------|
| R is **not re-entrant** and must run on the process **main thread**: allocation and error jumps are not safe elsewhere; rpy2 users hit `signal only works in main thread` and `Concurrent access to R is not allowed`. | [HaskellR: how R is embedded](https://tweag.github.io/HaskellR/docs/how-r-interpreter-is-embedded.html), [r-devel thread](https://stat.ethz.ch/pipermail/r-devel/2019-May/077843.html), [rpy2 issue 809](https://github.com/rpy2/rpy2/issues/809) |
| Embedded R **cannot be re-initialized** in one process (already documented in feature 023 research D3). | [R-exts: linking GUIs and front-ends](https://rstudio.github.io/r-manuals/r-exts/Linking-GUIs-and-other-front-ends-to-R.html), [Embedding R in other applications](https://developer.r-project.org/embedded.html) |
| `R_SignalHandlers = 0` is the documented way to keep the host's signals; `R_CStackLimit` must be set **after** init. | [R-exts](https://rstudio.github.io/r-manuals/r-exts/Linking-GUIs-and-other-front-ends-to-R.html) |
| Python's isolated configuration is the documented embedding mode; PEP 741 (`PyInitConfig_*`, `Py_InitializeFromInitConfig`) adds an **opaque, name-based** config API in 3.14 that does not require the struct layout. It is excluded from the limited C API. | [Init config docs](https://docs.python.org/3.14/c-api/init_config.html), [PEP 741](https://peps.python.org/pep-0741/) |
| Per-interpreter GIL (3.12) and `concurrent.interpreters` (3.14) give concurrency inside one process; extensions that do not declare support are rejected on import. They do **not** provide fault isolation. | [PEP 684](https://peps.python.org/pep-0684/), [LWN](https://lwn.net/Articles/963512) |
| `bun:ffi` is documented as experimental; `JSCallback` is not thread-safe by default; `threadsafe` helps only when another thread runs JS (a Worker); Bun recommends Node-API for stability. A long native call blocks the JS thread unless it runs in a Worker. | [Bun FFI docs](https://bun.com/docs/runtime/ffi) |
| Jupyter-style kernels use a separate process and support interrupt either by signal or by message. | [jupyter_client: making kernels](https://jupyter-client.readthedocs.io/en/latest/kernels.html) |
| Rserve gives each connection an isolated session but depends on `fork` (not available on Windows) and a synchronous protocol. | [Urbanek, DSC 2003](https://www.R-project.org/conferences/DSC-2003/Drafts/Urbanek.pdf) |
| Process confinement primitives differ per OS: Linux Landlock (needs `PR_SET_NO_NEW_PRIVS`, no syscall filtering) and seccomp; macOS `sandbox-exec` is deprecated but works; Windows Job Objects give memory/CPU/process limits and kill-on-close. | [LWN](https://lwn.net/Articles/1048742/), [jmmv on sandbox-exec](https://jmmv.dev/2019/11/macos-sandbox-exec.html), [Microsoft: job objects](https://learn.microsoft.com/en-ie/Windows/Win32/procthread/nested-jobs) |

**This machine**: `libpython3.14.so.1.0` present, `Python.h` **absent** (no `python3-devel`); R 4.6.2 with headers and `libR.so`; `jsonlite` installed (but must not be required).

Not verified (no source found, no machine): macOS and Windows behavior of the hosts; free-threaded Python (`3.14t`) embedding; Python < 3.14 (no `PyInitConfig`).

---

## 3. Experiments

All sources in `experiments/`. Linux x86_64, single run each, warm figures over 300 calls.

### E1 — Header-free Python host, script by path (`pyhost.c`)

`dlopen(libpython3.14.so.1.0)`, `PyInitConfig_Create` / `SetInt("isolated", 1)` / `Py_InitializeFromInitConfig`, a one-time Python bootstrap defining `_cz_run(path, args)`, then a read-line loop. No Python headers were used.

| Check | Result |
|-------|--------|
| Startup (spawn → ready) | **38 ms** |
| First call / warm p50 / p95 | 0.36 ms / **0.112 ms** / 0.158 ms |
| Error quality | `File ".../err.py", line 2, in inner` — real file and line |
| Session state across calls | persists (`1`, `2`) |
| Interrupt (`SIGINT` during `while True: pass`) | `KeyboardInterrupt` → structured `"interrupted"` in **0.2 ms**; session still usable |
| Crash (`ctypes.string_at(0)`) | host exited with signal 11; **the driver survived**; respawn **39 ms**, usable |
| `__file__` and `sys.flags.isolated` | set; isolated = 1 |

### E2 — R host, script by path (`rhost.c`)

`Rf_initEmbeddedR` on the **main thread** of a dedicated process, `R_SignalHandlers = 0` plus our own `SIGINT` handler setting `R_interrupts_pending`, `source(path)` inside `tryCatch`/`withCallingHandlers`, JSON built **in C** (no `jsonlite`).

| Check | Result |
|-------|--------|
| `Rf_initEmbeddedR` return value | **1 on success** (confirms defect D5) |
| Startup / first call (Bun) | 155 ms / 41 ms (first `source()` loads R's parser libs) |
| Warm p50 / p95 | **0.51 ms** / 0.58 ms |
| Error quality | `Error in inner() : boom [/…/err.R:1]` — `file:line` recovered from `srcref` (plain `source()` gives no location) |
| State across calls | persists |
| Interrupt (`repeat {}`) | `"interrupted"` in **0.3 ms**; session usable afterwards |
| Crash (`pskill(getpid(), 11)`) | host died, driver survived, respawn 152 ms |
| Result value | works; a first draft printed `list(value=…)` because `source()` already returns a list (bug in the draft bootstrap, fixed) |

R's re-initialization limit disappears as a problem: a crashed or reset R session is a **new process**, which is exactly how R's own `parallel` package avoids the in-process limits.

### E3 — Limits and cleanup a host can apply that `Bun.spawn` cannot

| Check | Result |
|-------|--------|
| `RLIMIT_AS` 1.5 GiB, Python script allocates 3 GiB | clean `MemoryError` traceback, host alive |
| `RLIMIT_AS` 3 GB, R script allocates 3.2 GB | `cannot allocate vector of size 3.0 Gb [file:line]`, host alive |
| Parent killed | host died too (`PR_SET_PDEATHSIG`); no orphan |

(Linux only; macOS has no `PDEATHSIG` and a weaker `RLIMIT_AS`; Windows would use a Job Object — see §7.)

### E4 — The user's own interpreter / virtualenv

| Check | Result |
|-------|--------|
| `executable` set to a venv's `python3` | `sys.prefix` is the venv; a module only present in the venv's `site-packages` imports |
| No hint | the same import fails — the hint is required |
| Finding `libpython` for a given interpreter | ask it once: `sysconfig` gives `LIBDIR` and `INSTSONAME` (`/usr/lib64`, `libpython3.14.so.1.0`) — no hard-coded list |

Caveat that **requires a fallback**: an interpreter built without a shared library (for example some `pyenv` builds) has no `libpython.so`; the host cannot embed it, so those users keep the existing subprocess runner (feature 023), which needs no shared library.

### E5 — The production integration path from Bun (`bun_drive.ts`)

`Bun.spawn` + newline-delimited JSON over stdin/stdout, the same shape as the existing subprocess backend:

| Host | Startup | First call | Warm p50 / p95 |
|------|--------:|-----------:|---------------:|
| Python C host | 36 ms | 0.40 ms | **0.125 / 0.202 ms** |
| R C host | 155 ms | 40.9 ms | **0.52 / 0.82 ms** |

Compared with feature 023's measurements:

| | subprocess runner (023) | embedded in Bun Worker (023) | **C host (this research)** |
|---|---|---|---|
| Python warm p50 | 0.18 ms | 0.42 ms | **0.125 ms** |
| Python startup / cold | 37.8 ms | 84 ms | **36 ms** |
| R warm p50 | 0.80 ms | init-fatal | **0.52 ms** |
| R startup + first call | 231 ms | init-fatal | **≈196 ms** |
| Crash containment | yes | **no (host died)** | yes |

---

## 4. Options considered

| | A. Keep text runners (023 as is) | B. In-process FFI shims per language | **C. Per-language C host process behind one C ABI** | D. C ABI library used in-process *and* in a host | E. Jupyter-style kernels (ZeroMQ) | F. Rserve + Python server | G. In-process subinterpreters |
|---|---|---|---|---|---|---|---|
| Scripts as files via C interface | no (text) | **yes** | **yes** | yes | possible | possible | yes |
| Fault containment | yes | **no** (E: exit 139) | **yes** (E1/E2) | only in host mode | yes | yes | **no** |
| R works | yes | **no** in a worker; main thread only → blocks the app | **yes** (own main thread) | in host only | yes | yes | n/a |
| Cancellation | kill only | none | **SIGINT → structured interrupt, <1 ms** | host mode | message/signal | limited | no |
| Memory / output limits | no | no | **yes** (rlimit, E3) | host mode | via OS | via OS | no |
| Python without headers | yes (it is a script) | needs the dlopen trick | **yes (E1)** | yes | n/a | n/a | needs headers/trick |
| Respects user venv | **yes (runs the interpreter)** | partial | **yes with `executable` hint (E4)**; fallback to A when no shared lib | same | yes | partial | no |
| Warm latency (Python) | 0.18 ms | 0.42 ms | **0.11–0.13 ms** | 0.11 ms (host) | slower (ZeroMQ + messaging) | slower | fast |
| New dependencies | none | none | **none** (host is C) | none | ZeroMQ, kernel stack | Rserve package | none |
| Build/packaging cost | low | high (per-OS shim + signing) | **medium** (small C host + 2 modules; Python module header-free) | medium | high | high | high |
| Cross-platform | good | poor | good (POSIX first; Windows needs a Job-Object variant) | same | good | poor (Windows) | n/a |
| Fit with the "FFI + C interface" idea | none | exact, but unsafe | **same C interface, safe boundary** | exact for dev/tests | none | none | partial |

**Why not B (the literal reading of "through FFI")**: measured, not assumed — a worker thread cannot host R (feature 023 `init-fatal`; the sources in §2 say the same for any non-main thread), a fault inside either interpreter takes the app with it (exit 139), and a long native call blocks the JS thread unless it is isolated in a Worker. B's only advantage, speed, does not exist: the C host is faster than B (0.11 vs 0.42 ms).

**Why not E/F/G**: they add heavy dependencies or give up containment for no gain that the C host does not already deliver.

---

## 5. Recommended architecture

### 5.1 Shape: one C ABI, two language modules, one host program

```
 Bun main process
   ScriptBackend ("host")           ← new backend kind; "subprocess" stays as fallback
        │ Bun.spawn, framed JSON over stdin/stdout (cancel = signal)
        ▼
 cz-host  (small C executable, language-neutral main loop)
        │ dlopen(<module>) + dlsym of the ABI
        ├── libcz_python.so   (no Python headers; dlopen(libpython); PyInitConfig isolated)
        └── libcz_r.so        (links libR; main thread of the host; R_SignalHandlers=0)
```

* **`cz_script.h`** — the versioned, language-neutral C ABI. Conceptually: `cz_abi_version()`, `cz_open(config) → handle`, `cz_run_file(handle, request, result)`, `cz_cancel(handle)`, `cz_result_*` accessors, `cz_close(handle)`. The request carries the **file path**, the arguments, an optional `expected_sha256`, and limits; the result is structured (§5.3).
* **Split by language**: `libcz_python` and `libcz_r` are separate modules with no compile-time or load-time dependency on each other. A missing R never affects Python (fixes D7). Adding a language means adding one module that implements the ABI.
* **FFI's role**: the same ABI is bindable with `bun:ffi` for conformance tests and benchmarks (Python, main thread, in-process) and for an explicitly-labelled unsafe developer mode. Production runs the modules inside `cz-host`.

### 5.2 Scripts as external files

* The module **opens and reads the file itself**: Python compiles with the real path as the filename, sets `__file__`, puts the script's directory on `sys.path`; R uses `source(path)` with `keep.source = TRUE`.
* The module hashes the **exact bytes it executes** and returns `content_sha256`. If the request carries `expected_sha256` and it differs, the run is refused with a distinct outcome ("content changed"). This closes the read-then-run race for feature 027's re-consent requirement (check and execution see the same bytes).
* A missing or unreadable file is a distinct outcome ("source missing"), not a generic failure — which is what 027's Relink flow needs.

### 5.3 Structured result (same shape for both languages)

`outcome` (`ok` / `error` / `interrupted` / `timeout` / `source_missing` / `content_changed` / `host_fault`), `value` (text), `error {type, message, traceback, file, line}`, `stdout`, `stderr`, `files` produced in the working directory, `content_sha256`, `duration_ms`. R gets its `file:line` from `srcref` (E2) so the quality gap with Python's tracebacks is small.

### 5.4 Cancellation and limits

* Cancel = `SIGINT` to the host → `KeyboardInterrupt` / R interrupt (E1/E2: <1 ms), then escalation `SIGTERM` → `SIGKILL` after a grace period for code stuck in C extensions that ignore signals; the whole process group is signalled (scripts may spawn children).
* Limits set by the host before running: address-space cap (E3), CPU time, output size; wall time enforced by the app.
* `PR_SET_PDEATHSIG` on Linux so a dead app leaves no orphan hosts (E3); the macOS/Windows equivalents are listed in §7.

### 5.5 Interpreters and environments

* Python: probe the chosen interpreter once for `LIBDIR`/`INSTSONAME` (E4) and pass the interpreter as `executable` so a venv's packages are found. **Minimum Python for the host is 3.14** (it relies on `PyInitConfig`); older interpreters, interpreters without a shared library, and any failure to start the host use the **existing subprocess runner** with no loss of function.
* R: no `jsonlite` requirement (JSON handled in C); arguments are converted by a small parser in the module.

### 5.6 Build and packaging

* `cz-host` and `libcz_python` build everywhere a C compiler exists (no Python or R development files needed); `libcz_r` builds only where R headers/lib exist and is optional. This replaces the all-or-nothing `script_shim` target.
* Staged beside the llama shim (`scripts/stage-native.ts`); macOS needs signing of the host and modules (as for the llama shim).

### 5.7 Wire protocol

Start with one JSON object per line in each direction (what E1/E2/E5 used; 0.11 ms warm), with explicit request ids, a `protocol` version in the ready line, and length limits. A binary framing is a later optimization with no known need.

---

## 6. Interface improvements, mapped to the findings

| Finding | Improvement |
|---------|-------------|
| D1 text, not files | `cz_run_file(path, …)`; module reads the file; real filename/line in errors; `__file__`, sibling imports |
| D2 side-channel results, string splicing | structured result returned through the ABI; no per-call JSON files; no spliced code strings |
| D3 non-isolated Python | `PyInitConfig` with `isolated = 1` and an explicit `executable` |
| D4 hard-coded libpython list | ask the interpreter (`sysconfig`) |
| D5 wrong success check | `Rf_initEmbeddedR` returns 1 on success; covered by a conformance test |
| D6 `jsonlite` + thread hacks | R runs on its own process main thread; JSON in C; no `R_CStackLimit`/JIT hacks |
| D7 one library, R-gated | one module per language + a neutral host |
| D8 no cancel/limits/versioning | signals, rlimits, output caps, `cz_abi_version()` + a protocol version in the handshake |
| D9 host-fatal faults | process boundary (E1–E3) |

---

## 7. Risks and unknowns

| Risk | Severity | Mitigation / next step |
|------|----------|-----------------------|
| macOS/Windows not verified. `PR_SET_PDEATHSIG` and `RLIMIT_AS` semantics differ; Windows has no `fork`-style helpers and needs Job Objects. | High for those platforms | First release is Linux-verified, ABI kept portable; other platforms keep the subprocess backend until a host is verified (the app already ships macOS/Windows configuration unverified — feature 012). |
| Python < 3.14 and interpreters without `libpython.so` cannot use the host. | Medium | Fallback to subprocess (kept). Measure how common this is among users before deciding whether to support 3.12/3.13 via the struct-based `PyConfig` (needs headers or a per-version layout table — not recommended). |
| Free-threaded Python (`3.14t`) embedding untested. | Low | Detect and fall back; test later. |
| Code stuck in a C extension that ignores `SIGINT`. | Medium | Escalation to `SIGKILL` after a grace period; session restarts (respawn is 36–152 ms). |
| fd-level output (C code writing to fd 1/2 directly, not `sys.stdout`) bypasses in-language capture. | Medium | Host redirects fd 1/2 to capture pipes while a script runs; add to the conformance suite. |
| First-call cost of R (≈41 ms) and startup (155 ms) is perceptible. | Low | Keep one warm R host per session; pre-warm on first script registration. |
| Maintenance cost of a C host plus two modules. | Medium | Small surface (the ABI); conformance suite shared by both languages; the old Worker prototype and `script_shim.c` are removed, so net code does not grow much. |
| Security: the host adds no new trust boundary, but gives a place to add confinement (Landlock/seccomp, Job Objects). | n/a | Out of scope for this feature; the process boundary makes it possible later. |

---

## 8. Suggested delivery order (for the plan)

1. **Conformance suite + ABI header** (language-neutral behaviours: file by path, structured result, interrupt, limits, crash, state, venv). Run first against the experiments' hosts to validate the suite itself.
2. **Python module + host** (header-free), Bun `host` backend behind the existing `ScriptBackend` contract, subprocess fallback.
3. **R module** (main-thread host, `srcref` locations, JSON in C).
4. **Switch `backend: "auto"`** to the host where available; remove the Worker prototype and `script_shim.c`.
5. **Optional**: confinement (Landlock/seccomp, Job Objects), binary framing, free-threaded support.

---

## 9. Sources

* [Python Initialization Configuration (3.14)](https://docs.python.org/3.14/c-api/init_config.html) · [PEP 741 – Python Configuration C API](https://peps.python.org/pep-0741/) · [PEP 684](https://peps.python.org/pep-0684/) · [LWN on sub-interpreters](https://lwn.net/Articles/963512) · [PEP 779 discussion (free-threading)](https://discuss.python.org/t/pep-779-criteria-for-supported-status-for-free-threaded-python/84319)
* [R-exts: Linking GUIs and other front-ends to R](https://rstudio.github.io/r-manuals/r-exts/Linking-GUIs-and-other-front-ends-to-R.html) · [Embedding R in other applications](https://developer.r-project.org/embedded.html) · [HaskellR: how R is embedded](https://tweag.github.io/HaskellR/docs/how-r-interpreter-is-embedded.html) · [r-devel: R API from a secondary thread](https://stat.ethz.ch/pipermail/r-devel/2019-May/077843.html) · [rpy2 issue 809](https://github.com/rpy2/rpy2/issues/809) · [rpy2 embedded module](https://rpy2.github.io/doc/v3.6.x/html/_modules/rpy2/rinterface_lib/embedded.html)
* [Bun FFI](https://bun.com/docs/runtime/ffi) · [Jupyter kernels](https://jupyter-client.readthedocs.io/en/latest/kernels.html) · [Rserve (DSC 2003)](https://www.R-project.org/conferences/DSC-2003/Drafts/Urbanek.pdf)
* [LWN: Landlock/seccomp discussion](https://lwn.net/Articles/1048742/) · [macOS sandbox-exec](https://jmmv.dev/2019/11/macos-sandbox-exec.html) · [Windows job objects](https://learn.microsoft.com/en-ie/Windows/Win32/procthread/nested-jobs)
* In-repo: `specs/023-python-r-scripts/{research.md,benchmark.md}`, `src/native/shim/script_shim.c`, `src/bun/scripts/**`.
