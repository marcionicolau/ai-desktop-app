# Quickstart: Model Roles & Fusion Validation

Prereqs: built native shim (`bun run build:native`), ≥2 GGUFs in `models/`
(e.g. a ~360M executor + a larger planner), `bun run dev`.

## VS-1 — Tag CRUD + binding (US1; FR-001, FR-002, FR-005)

1. Open Roles panel → create tag `writer` → bind the smaller GGUF.
2. Restart app → `role.list` shows `writer` bound with model metadata.
3. Externally rename the bound file → panel shows `broken` (not a crash);
   rename back → `bound` again.
4. `role.create {name:"Writer!"} ` → `INVALID_PARAMS`; duplicate name →
   `ALREADY_EXISTS`.

## VS-2 — Download & bind in one flow (US1; FR-004)

1. Roles panel → download → pick HF resolve URL + select tag `executor`.
2. Watch `model.download` progress → on `done`, tag binds automatically;
   `role.changed` fires.
3. Repeat with an unreachable URL → `.part` cleaned, binding untouched.

## VS-3 — Fusion turn (US2; FR-006, FR-007, FR-008)

1. Bind `planner` → larger model, `executor` → smaller model.
2. Chat → enable Fusion (planner/executor pickers populated) → send
   "plan then write a 4-line poem about tests".
3. Expect: plan phase streams into a collapsible Plan block (labeled with
   the planner model), then answer streams below; `chat.done` carries
   per-phase stats.
4. Second message: planner + executor phases both show warm KV reuse
   (`warm` flag per ctx) — faster than cold.

## VS-4 — Fusion gating + stop (US2; FR-006, FR-008)

1. Unbind `planner` → Fusion toggle refuses, names `planner`, offers a
   shortcut to the Roles panel.
2. Rebind; start a fusion turn; press Stop during the plan phase →
   turn lands `partial`, plan preserved, no answer phase.

## VS-5 — Fallback chain (US3; FR-009)

1. `writer` bound to a valid file; set fallback `[{model: <other.gguf>}]`.
2. Delete the primary file externally → generation through `writer`
   completes via fallback; `chat.phase`/notice records `servedBy:fallback`.
3. Remove the fallback file too → typed `ROLE_UNBOUND`/`MODEL_NOT_FOUND`
   naming the attempted chain.

## VS-6 — Shared slot + persistence (FR-011, SC-005, SC-006)

1. Bind `planner` and `executor` to the same file → fusion turn runs with
   one loaded instance (registry shows 1 slot; memory ≈ single model).
2. `bun run typecheck && bun run lint && bun test ./tests &&
   bun run build:renderer && bun run build:native` — all green.
