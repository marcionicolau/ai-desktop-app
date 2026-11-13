# Experiments (research for feature 028)

Throw-away C hosts and drivers used to ground `../research.md`. Measured on
Fedora 44 / Linux 7.3 x86_64, Python 3.14.10 (`libpython3.14.so.1.0`, **no**
development headers), R 4.6.2 (headers present), gcc 16, Bun 1.4.

| File | What it is |
|------|------------|
| `pyhost.c` | Header-free Python host: `dlopen(libpython)`, 3.14 `PyInitConfig` (isolated), executes a script **by path**, one JSON line per call. Honors `CZ_PYEXE` (venv), `CZ_MEM_MB` (`RLIMIT_AS`), dies with its parent (`PR_SET_PDEATHSIG`). |
| `rhost.c` | R host: `Rf_initEmbeddedR` on the main thread, `source()` of the script path, JSON built in C (no `jsonlite`), `SIGINT` → R interrupt, `file:line` from `srcref`. Same env knobs. |
| `drive_py.py`, `drive_r.py` | Python drivers: startup, warm latency, error quality, state, interrupt, crash containment, respawn. |
| `bun_drive.ts` | The production path: `Bun.spawn` + NDJSON, startup/first-call/warm latency. |
| `scripts/` | The test scripts (`ok`, `err`, `loop`, `crash`, `state`, `mem`, `info`, `venvtest`). |

Build:

```sh
gcc -O2 -Wall pyhost.c -ldl -o pyhost
gcc -O2 -Wall -I/usr/include/R rhost.c -L/usr/lib64/R/lib -lR -Wl,-rpath,/usr/lib64/R/lib -o rhost
python3 drive_py.py; python3 drive_r.py; bun run bun_drive.ts
```

The drivers expect `scripts/` next to them. `venvtest.py` needs a venv at
`./venv` containing a module `venvmod` (see research.md E4).
