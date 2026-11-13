# Contract: tool_call grammar — run_script

Extends the feature-015 fenced convention. One JSON object per
````tool_call` block; a new tool name joins `read_file`/`list_dir`.

## Call shape

````text
```tool_call
{"tool":"run_script","script":"<script-id>","args":{"<param>":<value>, ...}}
```
````

- `script` — required string; registry id (slug). Unknown or disabled →
  `refused` with reason `unknown-script`; the model is told the name
  resolved to nothing (never executes).
- `args` — optional object. For scripts with declared params each entry
  is validated against the declaration (type, required); extras →
  refused `invalid-args`. For `params: []` scripts the whole payload may
  instead carry `"input": "<free text>"` passed as the single raw arg.

## Verdict pipeline (loop branch order)

1. `parseCallBody` → malformed
2. script policy inactive (`deny` or no ready runtime) → `disabled`
3. registry lookup miss/disabled → `unknown-script`
4. arg validation failure → `invalid-args` (details fed back)
5. pending decision (`tool.update` pending → `tool.respond`)
6. session queue → backend call → `tool_result` injected

Steps 1–4 produce a `tool_result` refusal block; generation continues
as today. Steps 5–6 mirror the existing approved/executed path and
share the per-turn budget of 5 — script calls and file calls count in
one pool (FR-012).

## Result block

````text
```tool_result
{"status":"ok","content":"<captured stdout, capped>"}
```
````

`status` variants: `ok` • `error` (nonzero exit — stderr tail in
content) • `timeout` • `denied` • `refused` • `elided` (existing
context-overflow elision). `sessionRestarted` losses append a
`"session restarted — prior state lost"` line to `content` so the
model can re-establish state it assumed.

## Prompt injection

When script policy is active, the injected instruction block gains a
script section listing each enabled script as
`name — description | params: a:type(req), b:type` so the model emits
valid calls. Disabled/absent policy → no section → byte-identical
prompt.
