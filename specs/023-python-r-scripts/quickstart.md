# Quickstart: Python & R Script Calling

Validation scenarios proving the feature end-to-end. Prerequisites:
`python3` on PATH (`python3 --version`); `Rscript` for R coverage
(`Rscript --version`); the dev app (`bun run dev`).

Contracts referenced: [tool-call.md](contracts/tool-call.md) ·
[rpc.md](contracts/rpc.md) · [pack-script.md](contracts/pack-script.md)
· [backend.md](contracts/backend.md)

## S1 — Register & manual run (P2)

1. Scripts surface → New: name `add-one`, runtime `python`, stored
   source `print(int(input_value) + 1)` with param `input_value: number`.
2. Save → entry lists with runtime badge `python ✓`.
3. Run with `input_value=41` → result shows `42`, exit 0, duration,
   runId — **proves** `script.run` + registry + validation + capture.

## S2 — Model tool-call with consent (P1)

1. Settings → Scripts: mode `ask`; ensure a runtime is ready.
2. Chat: "Run the add-one script on 41".
3. Model emits ````tool_call` `{"tool":"run_script","script":"add-one",
   "args":{"input_value":41}}` → inline card shows script+args pending.
4. Approve → card shows executed + output `42`; assistant's final answer
   uses it — **proves** FR-004/005/011 + result injection.

## S3 — Session persistence + reset (FR-018–020)

1. Script `set-var` (`memo = input_text`) then `get-var` (`print(memo)`),
   `params: []`-style raw-input second script.
2. Model calls `set-var` with "hello", then `get-var` → outputs `hello`
   — state survived across calls in one session.
3. Settings → reset Python session → `get-var` again → NameError error
   result — reset cleared state; session restarted transparently.

## S4 — Failure paths

- **Missing runtime**: unset/detect R with no Rscript → R entries show
  `missing`; calls error `runtime-unavailable`; python unaffected.
- **Timeout**: script `sleep(10)` with `timeoutMs: 2000` → verdict
  `timeout`, partial output flagged; app stays responsive.
- **Crash**: script raising `SystemExit`/`os._exit(1)` → `error` verdict
  + `sessionRestarted` on next call; host unaffected.
- **Refusals**: call an unregistered name → `unknown-script` refused;
  wrong arg types → `invalid-args` refused pre-execution.

## S5 — Policy modes

`deny` → no script section in prompt, calls refused `disabled` ·
`allow-session` → second+ call in a conversation auto-approves ·
restart clears grants.

## S6 — Pipeline step (FR-021)

1. Fixture pack with `runtime: script` skill + `scripts.run` capability;
   enable → contribution registers.
2. `run.start` the pipeline → script step hits pending approval
   (`tool.update`) → `tool.respond` approve → step output feeds the next
   step; trace shows executed.
3. Same pack without the capability → enable fails.
4. Step naming a missing script → run fails `SCRIPT_NOT_FOUND`.

## S7 — Benchmark gate (FR-022/023)

```bash
bun scripts/bench-script-backends.ts
```

→ `specs/023-python-r-scripts/benchmark.md`: per-runtime × per-backend
table (cold start, warm p50/p95, state fidelity, RSS, forced-fault
survival, packaging check). Selection rule per backend.md: crash
containment gates; then latency/memory. Confirm `backend: "auto"`
resolves to the recorded winner.

## Gates

- `bun test ./tests/scripts ./tests/tools ./tests/fabric` green
- `tsc --noEmit` + lint clean
- `vite build` clean
- `deny` mode: prompts byte-identical (tested by prompt snapshot test)
