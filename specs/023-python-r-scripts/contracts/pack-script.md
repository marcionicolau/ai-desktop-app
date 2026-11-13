# Contract: Extension packs — runtime: "script"

Lets a pack pipeline/agent invoke a library script as a step (FR-021).
Extends the feature-017 pack schema — no new file kinds.

## Capability

`CAPABILITIES` gains `"scripts.run"`. A pack declaring any
`runtime: "script"` skill MUST declare it; enabling a pack whose
script skills lack the capability fails validation
(`CAPABILITY_DENIED`-class error at enable time).

## SKILL.md frontmatter

```yaml
---
name: analyze-corpus
description: score documents with the user's script
runtime: script            # NEW — alongside "prompt" | "component:<builtin>"
script: corpus-scorer      # library script id (slug)
params:                    # pack-declared → mapped to script args
  objective:
  limit: { default: 100 }
inputs:
  docs: { type: list }
outputs:
  scores: { type: json }
---
```

- `runtime: script` is valid on skills (not pipelines themselves);
  agents may use such skills as `llm`-sibling steps.
- `script` names a **library** entry — packs reference, they don't
  install (bundled sources are a follow-up; see assumptions).
- Input/port binding uses the existing `steps[].inputs` ref syntax;
  bound values become the script call's `args`.
- The script's declared `params` must cover the skill's mapped args —
  validated at enable/registration (CONTRACT_VIOLATION at pack
  validation), re-checked at run (SCRIPT_INVALID_ARGS).

## Execution contract

- The step calls `ScriptService.call` with initiator `"pipeline"` and
  the run id as consent namespace — a pending decision surfaces via
  `tool.update`, resolved by `tool.respond`, exactly like chat calls
  (identical policy: ask → prompt, allow-session → auto within the run,
  deny → refused).
- Outputs: if the script's captured stdout parses as JSON, it becomes
  the step's output object (validated against declared `outputs` like
  `runtime: prompt` model output); otherwise `{ "output": stdout }`.
- Unresolved script name → step fails `SCRIPT_NOT_FOUND`, failing the
  run with a located error (FR-021).
- Session/timeout/serialization/audit inherit FR-018/19/13 wholesale —
  pipeline calls share the runtime's session queue and the audit file.
