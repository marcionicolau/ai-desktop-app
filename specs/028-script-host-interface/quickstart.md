# Quickstart: Script Host Interface (feature 028)

End-to-end validation on Linux. Requires: C toolchain + cmake, Bun, Python
≥3.14 with a shared library, R (optional — only affects `libcz_r`).

## 1. Build

```sh
cmake -S src/native/script-host -B native/build/<platform>   # new target dir
cmake --build native/build/<platform>
bun scripts/stage-native.ts native/build/<platform> native/out/<platform>
```

Expected: `native/out/<platform>/cz-host`, `libcz_python.so`, and
`libcz_r.so` **iff** R headers/lib were found. `libcz_python` builds with no
`Python.h` present (SC-007).

## 2. Conformance suite (SC-009)

```sh
bun run tests/conformance/suite.ts -- --module python --host native/out/<platform>/cz-host
bun run tests/conformance/suite.ts -- --module r --host native/out/<platform>/cz-host   # if built
```

Checks, per module: run-by-path with real file/line errors, structured
result shape, state across calls, SIGINT cancel ≤100 ms, memory limit →
`error` (OOM) not `host_fault`, interpreter crash → app survives + respawn,
`content_sha256` reported, `expected_sha256` mismatch → `content_changed`,
missing file → `source_missing`, venv package import. Deliberately broken
module (`--broken`) must fail loudly.

## 3. Benchmark (SC-004)

```sh
bun run tests/conformance/bench.ts -- --module python --iterations 300
```

Expected vs feature-023 figures: startup ≤38 ms (Py) / ≤231 ms (R incl.
first call); warm p50 ≤0.18 ms (Py) / ≤0.8 ms (R). Append results to
`specs/028-script-host-interface/benchmark.md` beside 023's numbers.

## 4. App-level smoke (in `bun run dev`)

1. Settings → Scripts → backend `auto` → status shows `host` method.
2. Import/link a script that `import`s a sibling file and raises →
   error shows the real path + line; run again → works.
3. Edit the linked file → next model/pipeline run re-prompts
   (feature-027 flow; `expected_sha256` mismatch at the host).
4. `while True: pass` → cancel → interrupted ≤100 ms; next run works.
5. `ctypes.string_at(0)` → `host_fault` reported; next run respawns.
6. Kill the app mid-run → `pgrep cz-host` returns nothing.

## 5. Fallback check (FR-019)

Point `runtimes.python.path` at a Python <3.14 or a venv without
`libpython.so` → run works via subprocess; audit entry shows
`method:"subprocess"`, `methodReason:"python-3.11"` (or similar); the
one-time fallback notice appears once.

## 6. Gates

```sh
bun run typecheck && bun run lint && bun test ./tests && bun run build:renderer
```
