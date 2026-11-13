# Contract: Bun ↔ `cz-host` wire protocol (v1)

Newline-delimited JSON over the host's stdin/stdout — same transport as the
existing subprocess backend, so `host.ts` reuses the framing/drain utilities.
Host stderr is pass-through diagnostics (never protocol data).

## Handshake

```
$ cz-host --module /path/libcz_python.so --interpreter /path/python3 --lib /path/libpython3.14.so.1.0
→ {"protocol":1,"abi":1,"language":"python","ready":true}
```

- Bun validates `protocol == 1`, `abi == CZ_ABI_VERSION`, expected `language`;
  any mismatch ⇒ host marked unavailable → subprocess fallback with reason
  `"version-mismatch"` (FR-009).
- No ready line within the start timeout, nonzero exit, or garbage ⇒
  fallback with reason `"host-start-failed"`.

## Run

```
Bun→ {"id":"run-42","protocol":1,"op":"run","path":"/abs/tool.py",
      "args":{"n":3},"input":null,"cwd":"/data/script-runs/run-42",
      "expected_sha256":"abc…","limits":{"cpu_s":0,"mem_bytes":1610612736,
      "output_bytes":262144}}

→ {"id":"run-42","outcome":"ok","value":"9",
   "error":null,"stdout":"","stderr":"",
   "files":[],"content_sha256":"abc…","duration_ms":12}
```

- One outstanding `run` per host (SessionManager already serializes).
- `expected_sha256` present + file bytes differ ⇒ `"content_changed"`,
  nothing executes (FR-005); missing/unreadable ⇒ `"source_missing"` (FR-006).
- Response shape is fixed by data-model.md; unknown keys ignored;
  `outcome` outside the enum ⇒ treated as `host_fault`.
- Size caps apply on the wire: `stdout`/`stderr` strings ≤ `output_bytes`
  (+ a `truncated:true` marker key in the response when clipped, FR-012).

## Cancel & escalation

- Cancel = **signal, not a protocol line**: `SIGINT` to the host →
  `cz_interrupt()` → script reports `"interrupted"` (SC-003 ≤100 ms).
- Grace period elapses (run still outstanding) ⇒ `SIGTERM` to the **process
  group** (child processes included, FR-011 edge), then `SIGKILL`.
- Forced kill ⇒ the outstanding request resolves as `interrupted` with
  `sessionRestarted`; host respawns on next call (state persists only while
  the process lives — FR-017).

## Fault handling

- Host exits mid-run (segfault etc.) ⇒ outstanding call resolves as
  `host_fault`; Bun marks the session dead and respawns at next `ensure()`
  (SC-002: ≤1 s Python / ≤2 s R).
- Host exit at idle ⇒ same respawn path; never fatal to the app (FR-010).
- `PR_SET_PDEATHSIG` (Linux) on host start ⇒ app crash leaves no orphans
  (FR-013); `dispose()` kills cleanly on normal shutdown.

## Session lifecycle ops

Reset (feature-023 restart semantics) = kill host + respawn. Status
queries stay Bun-side (`HostSession.state`) — the wire carries no status op.
