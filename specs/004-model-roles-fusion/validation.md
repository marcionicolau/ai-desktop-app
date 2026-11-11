# Validation Report — Feature 004 (Model Roles & Fusion)

Date: 2025-11-24. Host: linux-x64 (headless). Tasks: T021–T023.

Note: headless environment — VS scenarios verified by automated
equivalents (unit/integration tests + static contract checks). Live-GUI
steps are annotated where a manual pass is still recommended.

## VS-1 — Tag CRUD + binding

- `tests/roles/roles.test.ts`: slug/`ALREADY_EXISTS` validation, bind
  (library basename + external path), `bound/unbound/broken` derivation,
  `default`↔`activeModelPath` sync, `ROLE_IN_USE` delete gating.
- `tests/rpc/role.test.ts`: all `role.*` methods through the typed
  contract; `role.changed` emission.
- Manual: restart persistence + external rename → `broken` badge
  (state derivation is unit-tested; live badge re-render is UI-level).

## VS-2 — Download & bind

- `tests/rpc/role.test.ts`: `model.download` with `tagName` validates the
  tag upfront (`NOT_FOUND` before any bytes); binding applies only
  post-rename so `.part`/failure never binds (FR-004).
- Manual: real HF download progress + tag-select in ModelLibrary.

## VS-3 — Fusion turn

- `tests/llama/fusion.test.ts`: exact event order
  (`chat.phase:plan` → plan tokens → `chat.phase:answer` → answer tokens),
  `<plan>` injection into the executor prompt, per-role param cascade,
  shared slot for same-path roles.
- `tests/rpc/fusion.test.ts`: `conversation.setMode` persist/validation.
- Per-phase `TurnStats` shape verified by contract typecheck
  (`chat.done.stats.plan/answer/total`).
- Manual: warm-KV speedup on the second turn (native-path observation).

## VS-4 — Fusion gating + stop

- `tests/rpc/fusion.test.ts`: `conversation.setMode` refuses fusion with
  `ROLE_UNBOUND` naming the missing role (`planner role "planner" ...`).
- `tests/llama/fusion.test.ts`: "partial plan stops before the answer
  phase" — stop-at-boundary, plan preserved, `answer` undefined.
- FusionControls renders only bound tags + inline `ROLE_UNBOUND` error.

## VS-5 — Fallback chain

- `tests/roles/roles.test.ts`: `resolveCandidates` ordering —
  missing-file lazy skip, primary-first, fallback flags, empty →
  `ROLE_UNBOUND` via `resolve()`.
- `tests/llama/fusion.test.ts`: load failure → next candidate serves
  (`servedBy:"fallback"`); mid-stream failure does NOT retry (no
  duplicated output).
- `tests/rpc/fusion.test.ts`: single-mode end-to-end — primary slot load
  failure → fallback serves "HI"; `chat.phase` carries
  `servedBy:"fallback"`; `msg.phases.answer.servedBy` persisted.

## VS-6 — Shared slot + persistence (T021)

- `tests/roles/registry.test.ts`: "two acquires on the same path share
  one slot (FR-011)" — one native model/context regardless of role count.
- `tests/llama/fusion.test.ts`: "roles on the same file share one slot" —
  planner+executor bound to the same GGUF → `registry.size() === 1` after
  a full fusion turn; peak memory ≈ one model instance.
- Sequential phase execution bounds decode memory to one active context.

## T023 — Quality gates (all PASS)

| Gate | Command | Result |
|------|---------|--------|
| Typecheck | `tsc --noEmit` (`bun run typecheck`) | PASS |
| Lint | `oxlint src/bun src/renderer src/shared` | PASS — 0 warnings |
| Tests | `bun test ./tests` | PASS — 92/92 across 17 files |
| Renderer build | `bun run build:renderer` | PASS (pre-existing >500 kB chunk advisory) |
| Native build | `bun run build:native` | PASS — `libllama_shim.so` + llama/ggml staged |
