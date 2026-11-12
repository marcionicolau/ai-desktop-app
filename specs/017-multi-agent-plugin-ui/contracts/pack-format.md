# Contract: Extension Pack Format v1 (API_LEVEL = 1)

A pack is a directory (or `.tgz` of one) with this layout:

```text
<pack>/
├── pack.yaml                 # required manifest
├── skills/<name>/SKILL.md    # components & pipelines (frontmatter contract)
├── config/agents/<name>/AGENT.md  # agent tree nodes (optional)
└── views/<viewId>/index.html # static UI assets (optional)
```

## pack.yaml

```yaml
name: my-pack            # slug-safe [a-z0-9-], unique per install
version: 1.0.0           # semver
apiLevel: 1              # must equal host API_LEVEL
description: What this pack adds.
capabilities:            # closed enum; absent = no bridge access
  - models.generate
  - storage
  - runs.read
  - views.theme
  - commands.invoke
contributions:
  skillsDir: skills            # default
  agentsDir: config/agents     # default
  views:
    - id: results
      title: Results Explorer
      slot: tab                # tab | panel
      entry: views/results/index.html
      minWidth: 480
  commands:
    - id: run-analysis
      title: Run full analysis
      run: { pipeline: analyse_case }
```

All-or-nothing validation (FR-002): any malformed file fails the whole pack
with a located `PackError {file, path, message}` — no partial registration.

## SKILL.md subset (ported from spec-agents)

Frontmatter (YAML via `Bun.YAML`):

```yaml
---
name: summarize_notes        # becomes <pack>:summarize_notes
version: 1.0.0
domain: notes                # optional grouping
description: One-line catalogue entry.
runtime: prompt              # prompt | component:<builtin-id>
params:
  tone: {required: false, default: neutral, description: writing tone}
inputs:
  transcript: {type: text, constraints: {min_chars: 20}}
outputs:
  summary: {type: text}      # text|json|number|any|list only
prompt: {temperature: 0.2, grounding: true}   # optional overrides
---
# Title

## When to use ...   ## Instructions ...   ## Interpreting ...  ## Common mistakes ...
```

- `runtime: prompt` → the `## Instructions` section is the template;
  `{params.x}` / `{inputs.x}` / `{objective}` placeholders validated at
  registration. Output ports limited to `text|json|number|any`.
- `runtime: component:<id>` → `id` must be in the host built-in library:
  `text.concat`, `text.template`, `json.extract`, `list.map`, `list.filter`,
  `const` (D6). Anything else → manifest error.
- `kind: pipeline` skills instead declare `steps:` — a DAG of
  `{id, uses: <skill-ref>, params, inputs}` where `inputs` map other steps'
  output ports; refs may be local (`name`) or cross-pack (`<pack>:<name>`,
  enabled packs only).

## AGENT.md subset

```yaml
---
name: research_lead
kind: router                 # router | sequential | planner | llm | pipeline
model: default               # host model role/tag — resolved via roles service
children: [stats_team, notes_digest]
fallback: rules              # optional named fallback agent
budget: {maxDepth: 3, maxDelegations: 12}
pipeline: document_summary   # kind: pipeline only
---
System prompt body (guidance, loaded into planner/LLM prompts).
```

Whole-tree validation before any run: refs exist, acyclic, depth ≤ budget,
kind constraints (only `router`/`sequential` may have children;
`pipeline` needs `pipeline:`).

## Views

Static assets only: `index.html` + relative js/css/img inside the view dir.
No network access (navigation locked to `views://` in-view resources),
no host APIs except the injected `ext.*` bridge (see view-bridge.md).

## Errors

Every validation/execution failure is a located error:
`{code, file?, path?, message}` — `code` ∈ `PACK_INVALID`,
`PACK_INCOMPATIBLE`, `CONTRACT_VIOLATION`, `CAPABILITY_DENIED`,
`RUN_FAILED`.
