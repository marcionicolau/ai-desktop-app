# Research: Multi-Agent Workspace & Extension Plugins

Resolves every unknown raised during planning. Two reference architectures were
studied: `marcionicolau/spec-agents` (agent-fabric: domain packs, `SKILL.md` /
`AGENT.md` contracts, `runtime: prompt`, `requires_api` gating) and
`marcionicolau/legal-saas` (legal_fabric pack + FastAPI sidecar + dedicated
web UI — the "extension brings its own surface" shape, mapped to FR-017's
declarative-packs-only decision).

## D1 — Extension architecture pattern

**Decision**: *Contribution-point pattern + sandboxed view surfaces* — the
same shape VS Code extensions use. A pack declares contributions in a
manifest; the host owns every extension point (workspace browser, run
engine, view slots, command palette); contributed UI renders in isolated
surfaces that talk to the host through a narrow typed bridge.

**Rationale**: keeps all trust decisions in one place (the bridge + the
consent dialog), lets packs be pure data + static assets, and matches
FR-017's host-embedded runtime. Micro-frontend/module-federation patterns
were rejected: they load pack JS into the host renderer's JS realm — no
fault isolation, no capability boundary (violates FR-013/FR-014).

**Alternatives considered**: (a) in-process `import()` of pack modules —
rejected, no isolation and contradicts declarative-only packs; (b) sidecar
process per pack (legal-saas literal) — rejected by spec Q1 answer;
(c) declarative-UI-only (host renders pack-described widgets) — rejected,
too weak for a "dedicated domain UI" like legal-web-ui.

## D2 — Extension view isolation mechanism

**Decision**: one Electrobun `BrowserView` per visible extension view,
created/positioned by the main process, anchored into a host-defined slot
region; each view gets `sandbox` hygiene, its own `partition` (separate
storage/cookies), `viewsRoot` pointed at the pack dir, and `allowedProtocols`
restricted so it cannot reach `views://` host assets or `appData://`
outside its dir.

**Rationale**: `BrowserView` is Electrobun 2.x's native OOPIF mechanism —
a real separate webview with its own process/partition, giving the FR-013
fault isolation guarantee for free (a view crash cannot take down the host
renderer). `sandbox: true` exists exactly for untrusted content but disables
RPC entirely; we instead attach a **narrow dedicated RPC schema** (D4) which
keeps typed calls while exposing only `ext.*` — strictly less capable than
the host bridge.

**Alternatives considered**: (a) `<iframe sandbox>` in the host renderer —
same-process, weaker isolation, CSP bookkeeping; (b) `<webview>` tag from
renderer — viable but pushes lifecycle into renderer; main-side
`BrowserView` keeps native handles in the process that owns them;
(c) separate `BrowserWindow` per view — breaks "render inside host slot".

## D3 — Pack manifest & contract format

**Decision**: `pack.yaml` at pack root (name, version, apiLevel,
capabilities, contributions: skillsDir/agentsDir/views/commands). Skills and
pipelines stay `SKILL.md` files with YAML frontmatter contracts + prose
body; agents stay `AGENT.md` trees. YAML parsed with `Bun.YAML` (Bun 1.4
built-in — **zero new deps**). Structural validation is hand-rolled and
produces located `PackError`s (field path + message), mirroring how
spec-agents validates frontmatter at registration.

**Rationale**: identical authoring format to spec-agents packs → the user's
existing packs port with only a manifest addition; `Bun.YAML` satisfies
Constitution VI.

**Alternatives considered**: JSON manifest — loses parity with spec-agents
and frontmatter still needs YAML; js-yaml dep — unnecessary given
`Bun.YAML`; zod — nice but a new dep for ~150 lines of validators.

## D4 — Host ↔ extension-view bridge

**Decision**: each extension `BrowserView` gets its own
`defineElectrobunRPC` instance whose schema exposes only `ext.*` methods:
`ext.context()` (packId, theme, locale), `ext.storage.get/set/remove`
(scoped to `dataDir()/pack-data/<pack>/`), `ext.runs.list/get` (that pack's
runs only), `ext.invoke(commandId, args)` (pack-declared commands executed
main-side). Host→view pushes are RPC events (`ext.themeChanged`,
`ext.runUpdated`). Every method checks the pack's declared `capabilities`;
undeclared → typed `CAPABILITY_DENIED`.

**Rationale**: typed, auditable, and the *only* channel — FR-014 falls out
of the schema itself. Capability-gating enforces FR-005's consent contract.

**Alternatives considered**: full host RPC to views — rejected, violates
FR-014; `sandbox:true` + raw postMessage — loses typing/validation; window
`postMessage` shim — no schema, harder to audit.

## D5 — Embedded multi-agent runtime

**Decision**: port agent-fabric's core loop to `src/bun/fabric/` in
TypeScript: `registry` (validates + namespaces contributions as
`<pack>:<name>`), `components` (built-in deterministic set +
`runtime: prompt`), `pipeline` (topological DAG executor with port
binding), `agent` (tree runner — `router` supervisors emit a validated JSON
delegation plan, `sequential` chains children), `runtime` (run lifecycle:
budget caps, trace records, abort, persistence). LLM calls go through the
existing `EngineLike` (`createRegistryEngine` gives per-role model
resolution for free — FR-018).

**Rationale**: FR-017 demands host-embedded execution; the codebase already
has prompt building, params cascade, KV snapshots, and the registry —
fabric becomes another consumer, not a parallel engine.

**Alternatives considered**: embed spec-agents via Python subprocess —
violates declarative-only packs and adds a Python runtime dependency to a
Bun app; shell out to `agent-fabric` CLI — same objection.

## D6 — Component library for declarative packs

**Decision**: v1 ships a small built-in component set — `runtime: prompt`
(model-backed, contract-validated JSON/text outputs), plus deterministic
utilities: `text.concat`, `text.template`, `json.extract`, `list.map`,
`list.filter`, `const`. Pack-declared pipelines compose only these.

**Rationale**: spec-agents proves `runtime: prompt` + a few deterministic
composables covers most pack intents while keeping the deterministic/LMM
boundary the references insist on ("LLMs plan, components compute").
Custom code components are explicitly out of scope (documented for
pack authors).

**Alternatives considered**: pack-shipped JS components — reopens the
in-process code execution hole; WASM components — large scope, no request.

## D7 — Remote install & archive format

**Decision**: `extension.install` accepts `{source}` = folder path | `.tgz`
file | direct archive URL | registry URL. Registry = a JSON document the
user pastes/enters listing `{name, version, url, sha256?, description}` —
the user picks an entry, the host fetches the `.tgz`, shows the manifest,
and asks for enable consent (FR-020). Archives extract via
`DecompressionStream("gzip")` + a ~150-line tar reader (no dep). Caps:
64 MiB archive, 2k files, path-traversal-safe extraction.

**Rationale**: satisfies FR-019 (local + simple remote) without marketplace
scope; `.tgz` needs no zip dependency and `tar` is trivially parseable.

**Alternatives considered**: `.zip` — no built-in inflater for stored
entries in some paths and zip parsing is more code; git-clone install —
needs git on PATH, bigger surface; npm-style registry protocol — marketplace
scope creep.

## D8 — Run lifecycle, streaming & history

**Decision**: `run.start` spawns a main-process run worker (async generator
inside the fabric runtime — no threads); progress flows as `run.event`
messages (`step.status`, `delegation`, `artifact`, `done`) which handlers
persist into the `RunRecord` trace. Cancel = `run.cancel` → `AbortSignal` →
`engine.stop()`. History: JSON per run under `dataDir()/runs/<packId>/`,
capped at 50 newest per pack; disabling a pack mid-run aborts its runs
first (edge case in spec).

**Rationale**: matches existing token-streaming conventions
(`chat.token`/`chat.phase` events); async-gen keeps the run on one task —
no worker protocol needed.

**Alternatives considered**: Bun Worker per run — unnecessary overhead for
cooperative async work; persist only summaries — trace is a spec
requirement (US3).

## D9 — Capability model & consent

**Decision**: manifest `capabilities` is a closed enum: `models.generate`,
`storage`, `runs.read`, `views.theme`, `commands.invoke`. Enable-time
consent dialog renders human-readable descriptions; bridge enforces per
call (D4). Packs that need *no* capabilities still work (pure browse/run
contributions don't need consent).

**Rationale**: FR-005/FR-014 directly; a closed enum keeps the consent
dialog honest and reviewable.

**Alternatives considered**: free-form permission strings — unauditable;
no capability model (all packs get full bridge) — violates FR-014.

## D10 — API-level compatibility

**Decision**: `src/shared/pack-schema.ts` exports `API_LEVEL = 1`.
Manifest `apiLevel` must equal host level for v1 (exact match; a
`minApiLevel` range comes when level >1 exists). Mismatch → pack installs
but lands `disabled` with located reason (spec edge case: host upgrade
auto-disables).

**Rationale**: mirrors `@requires_api` in spec-agents; exact match avoids
speculating on a compatibility matrix that doesn't exist yet.

**Alternatives considered**: semver range — overkill at level 1; ignore
version — loses the auto-disable safety on host upgrades.

## Constitution check post-research

All six principles still pass — see plan.md gate table. Zero new
dependencies across D1–D10 (`Bun.YAML`, `DecompressionStream`, Electrobun
`BrowserView`, existing `EngineLike`).
