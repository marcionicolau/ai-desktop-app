# Data Model: Multi-Agent Workspace & Extension Plugins

All types live in `src/shared/pack-schema.ts` (manifest-facing) and
`src/shared/types.ts` (RPC-facing views). Persistence is JSON under
`dataDir()`; nothing crosses the FFI boundary.

## PackManifest (declared by the pack, `pack.yaml`)

```text
PackManifest {
  name: string            # slug-safe, unique across installed packs
  version: string         # semver
  apiLevel: 1             # must equal host API_LEVEL (D10)
  description?: string
  capabilities: Capability[]            # closed enum (D9)
  contributions: {
    skillsDir?: string    # default "skills"    → SKILL.md tree
    agentsDir?: string    # default "config/agents" → AGENT.md tree
    views?: ViewDecl[]    # static UI surfaces
    commands?: CommandDecl[]
  }
}
Capability = "models.generate" | "storage" | "runs.read"
           | "views.theme" | "commands.invoke"
ViewDecl    { id, title, slot: "panel"|"tab", entry: "views/<id>/index.html",
              minWidth?, minHeight? }
CommandDecl { id, title, description?, run: { pipeline|agent, params? } }
```

Validation: every field structural-checked at scan time; failures produce
located `PackError { pack, file, path, message }` → pack state `failed`
(FR-002). `capabilities` unknown values are a manifest error, not ignored.

## InstalledPack (host state, `extensions.json`)

```text
InstalledPack {
  id: string              # slug of manifest.name (dedup -2 on collision)
  dir: string             # dataDir()/extensions/<id>
  state: "installed"|"enabled"|"disabled"|"failed"
  error?: PackError       # set when state=failed
  source: { kind: "folder"|"archive"|"url"|"registry", ref: string }
  manifest: PackManifest  # last successfully parsed
  installedAt: number
}
```

State transitions: `installed →(enable+consent) enabled →(disable) disabled`;
any → `failed` (validation/compat); `enabled|disabled →(remove)` deleted
(dir + state + scoped pack-data retained-or-purged per remove flag).
Host upgrade changing `API_LEVEL` forces re-validation → incompatible
packs auto-`disabled` with reason (spec edge case).

## Contribution descriptors (RPC-facing, registered under `<pack>:<name>`)

```text
SkillView   { id, packId, name, domain, version, runtime:"prompt"|"component",
              inputs: PortDecl[], outputs: PortDecl[], params: ParamDecl[],
              description, guidance: {whenToUse, interpreting, mistakes} }
PipelineView{ id, packId, name, steps: {id, uses, params, inputs}[], }
AgentView   { id, packId, name, kind:"router"|"sequential"|"planner"|"llm"
                     |"pipeline", model?, children: AgentView[], fallback? }
PortDecl    { type:"text"|"json"|"number"|"any"|"list", constraints? }
```

## RunRecord (`dataDir()/runs/<packId>/<runId>.json`)

```text
RunRecord {
  id: string              # run_<ts>_<rand>
  packId, target: { kind:"pipeline"|"agent", id },
  objective: string, params: Record<string,unknown>,
  status: "queued"|"running"|"completed"|"failed"|"cancelled",
  trace: TraceEntry[], artifacts: Artifact[],
  budget: { maxSteps?, maxDelegations?, maxModelCalls?, maxDepth? },
  usage:  { steps, delegations, modelCalls, promptTokens, outputTokens,
            elapsedMs },
  error?: { code, message, path? },      # FabricError-like, located
  startedAt, endedAt?: number
}
TraceEntry { seq, stepId, kind:"step"|"delegation"|"artifact"|"note",
             path: string              # e.g. "lead/team/worker"
             status, input?, output?, startedAt, endedAt? }
Artifact   { name, type: PortDecl["type"], text|json|number, stepId }
```

History capped at 50 newest per pack (D8). `status` is terminal-only
`completed|failed|cancelled` once `endedAt` set — no orphans after
disable/remove (SC-006).

## ViewSession (in-memory, main process)

```text
ViewSession { viewId, packId, viewDeclId, browserViewId, partition,
              slot, bounds }   # destroyed on disable/remove/hide
```

## Relationships

```text
InstalledPack 1—n SkillView/PipelineView/AgentView (via manifest scan)
InstalledPack 1—n RunRecord (run.target → contribution id)
InstalledPack 1—n ViewSession (live only while enabled)
```

## Validation rules pulled from requirements

- FR-002: manifest fully validated before any contribution registers
  (all-or-nothing, like `parseEnvelope` in feature 008).
- FR-006: every contribution id is `<packId>:<declName>`; duplicates within
  a pack are a manifest error.
- FR-014: bridge capability check at each `ext.*` call; undeclared →
  `CAPABILITY_DENIED`.
- FR-019/020: remote packs persist `source.ref`; consent state is implicit
  in `enabled` (re-asked on re-enable after disable? — no: consent once per
  install, persisted; capability changes on update re-prompt).
