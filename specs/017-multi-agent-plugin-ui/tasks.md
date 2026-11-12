# Tasks: Multi-Agent Workspace & Extension Plugins

**Input**: Design documents from `/specs/017-multi-agent-plugin-ui/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Organization**: Tasks grouped by user story (US1–US4) for independent
delivery. Tests included per repo convention (failing test → implement).

## Phase 1: Setup

- [x] T001 Create `src/shared/pack-schema.ts`: `PackManifest`, `Capability`
  closed enum (`"models.generate"|"storage"|"runs.read"|"views.theme"|"commands.invoke"`),
  `ViewDecl`, `CommandDecl`, `PortDecl` (`type:"text"|"json"|"number"|"any"|"list"`),
  `ParamDecl`, `API_LEVEL = 1` (research D3, D9, D10).
- [x] T002 [P] Extend `src/shared/rpc-contract.ts`: append error codes
  `PACK_INVALID`, `PACK_INCOMPATIBLE`, `PACK_NOT_FOUND`, `CAPABILITY_DENIED`,
  `RUN_NOT_FOUND`, `RUN_ACTIVE`, `SOURCE_UNREACHABLE`, `ARCHIVE_INVALID` to
  `RPC_ERROR_CODES`; declare request/message types for `extension.*`,
  `pack.*`, `run.*`, `view.*` per `contracts/rpc.md`.
- [x] T003 [P] Create `src/bun/fabric/errors.ts`: located `PackError`
  (`{code, file?, path?, message}`) + `FabricError` for run-time failures;
  map onto `RpcError` shape used by handlers.

## Phase 2: Foundational (blocking all stories)

- [x] T004 Create `src/bun/fabric/frontmatter.ts`: split `SKILL.md`/`AGENT.md`
  into YAML frontmatter + body using `Bun.YAML.parse`; structural validator
  emitting located `PackError`s; export `parseMarkdownSpec(path)`.
- [x] T005 [P] `tests/fabric/frontmatter.test.ts`: valid spec round-trips;
  malformed YAML, missing `name`, bad port type, unknown `runtime` each →
  located `PackError` with `file`/`path`.
- [x] T006 Create `src/bun/fabric/registry.ts`: `ContributionRegistry`
  holding skills/pipelines/agents keyed `<packId>:<name>` (FR-006);
  `registerPack` all-or-nothing (any invalid file → whole pack rejected,
  FR-002); `unregisterPack`; cross-pack refs resolve only against enabled
  packs.
- [x] T007 [P] `tests/fabric/registry.test.ts`: namespacing prevents
  collisions across packs; duplicate name inside one pack → manifest error;
  unregister removes all contributions.
- [x] T008 Extend `src/shared/types.ts`: `InstalledPackView`, `SkillView`,
  `PipelineView`, `AgentView`, `RunSummary`, `RunRecord`, `TraceEntry`,
  `Artifact`, `Budget`, `Usage` per `data-model.md`.
- [x] T009 Extend `src/bun/store/paths.ts` (or equivalent) with
  `extensionsDir()`, `runsDir(packId)`, `packDataDir(packId)`; read
  `APP_DATA_DIR` live per call like existing paths.

## Phase 3: User Story 1 — Install and Manage Extension Packs (P1) 🎯 MVP

**Goal**: install/enable/disable/remove packs; manifest + apiLevel gating;
consent for capabilities; failure containment.

**Independent Test**: install valid + incompatible packs via RPC/UI; valid
pack lists contributions after enable; incompatible one rejected with
reason; enable/disable/remove without restart; malformed pack → `failed`
with located error while others load.

- [x] T010 Create `src/bun/extensions/store.ts`: `ExtensionsStore` —
  `scan()` (rebuild `dataDir()/extensions.json`, mark incompatible packs
  `disabled` w/ reason on `API_LEVEL` mismatch), `installFolder`,
  `installArchive`, `enable` (consent required when `capabilities`
  non-empty, FR-005), `disable` (aborts active runs via runtime hook),
  `remove(purgeData)`, `list()`, `get()`; all-or-nothing manifest
  validation (FR-002). `install` on an existing `packId` = replace files +
  revalidate + re-prompt consent when declared `capabilities` changed
  (update semantics per data-model note).
- [x] T011 Create `src/bun/extensions/fetch.ts`: `fetchPack(source)` —
  `folder` copy, `archive`/`.tgz` extract via `DecompressionStream("gzip")`
  + hand-rolled tar reader (path-traversal-safe, ≤64 MiB, ≤2000 files, D7),
  `url` fetch → tgz, `registry` fetch JSON index → entry pick → tgz;
  returns extracted dir + parsed manifest for preview.
- [x] T012 [P] `tests/extensions/store.test.ts`: scan/install/enable/
  disable/remove state machine; consent flag; apiLevel mismatch → disabled
  with reason; failed pack doesn't block others; state persists across
  store re-instantiation (FR-004); cold-start: `scan()` on a store with an
  already-enabled pack re-registers its contributions (I1 fix — see T020);
  reinstall with changed `capabilities` re-prompts consent (U2).
- [x] T013 [P] `tests/extensions/fetch.test.ts`: `.tgz` round-trip;
  traversal `../` entries rejected; >64 MiB cap → `ARCHIVE_INVALID`;
  registry JSON → entry url resolution; `file://` URL source works.
- [x] T014 `tests/extensions/fixtures/`: build `notes-pack` (manifest +
  `summarize-notes` SKILL.md + `document-summary` pipeline SKILL.md +
  `note-taker` AGENT.md tree, capabilities `["models.generate","storage"]`),
  `broken-pack` (bad frontmatter), `incompatible-pack` (`apiLevel: 99`);
  pack them as `.tgz` fixtures for T013.
- [x] T015 `src/bun/rpc/handlers.ts`: `ExtensionsStore` dep; handlers for
  `extension.scan/install/preview/enable/disable/remove`; emit
  `extension.changed` on transitions; `enable` accepts `{consent:true}`
  passthrough per `contracts/rpc.md` (consent lives on enable, not
  install — I3 fix); use `dialogs.pickFolder/pickFile`
  for local sources (feature 008 pattern).
- [x] T016 [P] `tests/rpc/extensions.test.ts`: full lifecycle over RPC;
  `enable` without `consent` when capabilities non-empty → `INVALID_PARAMS`;
  preview returns manifest without installing; remove purge.
- [x] T017 `src/renderer/src/features/extensions/ExtensionsPanel.tsx` NEW:
  pack list (name/version/state/capabilities), Install (folder/archive/URL
  entry), consent dialog rendering capability descriptions, enable/disable/
  remove buttons, failed-pack error display; wire into settings page.
- [x] T018 `src/renderer/src/lib/rpc.ts` (or equivalent): `extension.changed`
  event subscription → refresh panel state.

**Checkpoint**: US1 independently testable — install/enable/browse manifest
of a pack via UI with zero registry content rendering.

## Phase 4: User Story 2 — Browse Multi-Agent Specs (P2)

**Goal**: workspace browser showing agent trees, skill contracts, pipeline
DAGs from enabled packs — read-only, namespaced.

**Independent Test**: enable notes-pack; workspace lists
`notes-pack:summarize-notes`, `notes-pack:document-summary`,
`notes-pack:note-taker` with contracts; second pack with same names → no
collision.

- [x] T019 `src/bun/fabric/frontmatter.ts` (extend): `parseSkill` produces
  `SkillView` (ports, params, guidance sections When-to-use/Interpreting/
  Common-mistakes); `parseAgent` produces `AgentView` tree (kind, model,
  children, fallback); `parsePipeline` validates `kind:pipeline` `steps` DAG
  (acyclic, port refs exist).
- [x] T020 `src/bun/extensions/store.ts` (extend): on `enable`, feed pack
  through `ContributionRegistry.registerPack`; on `disable`, unregister;
  expose `contributions(packId)`. Cold-start path (I1 fix): `scan()` MUST
  also `registerPack` every pack whose persisted state is `enabled` so
  contributions survive app restart — otherwise enabled packs are
  invisible/unrunnable after relaunch (FR-004).
- [x] T021 [P] `tests/fabric/contracts.test.ts`: SKILL runtime must be
  `prompt` or `component:` + whitelisted builtin id (D6); pipeline steps
  DAG validation (cycle → error, bad port ref → error); agent tree acyclic
  + children only on `router`/`sequential`.
- [x] T022 `src/bun/rpc/handlers.ts`: `pack.contributions`, `pack.readSpec`
  handlers.
- [x] T023 [P] `tests/rpc/packs.test.ts`: contributions returns namespaced
  descriptors; readSpec returns frontmatter+body; disabled pack →
  `PACK_NOT_FOUND`.
- [x] T024 `src/renderer/src/features/fabric/WorkspaceBrowser.tsx` NEW:
  sidebar listing contributions grouped by pack then kind — including
  `commands` (U1 fix: render each `CommandDecl` as a runnable shortcut that
  calls `run.start` with its declared target+params once US3 lands);
  detail pane for selected skill (ports/params/guidance), pipeline
  (step DAG list), agent (hierarchy tree); wire navigation entry.
- [x] T025 `src/renderer/src/features/fabric/` detail components:
  `SkillDetail`, `PipelineDetail`, `AgentTree` (recursive tree renderer).

**Checkpoint**: enable pack → browse all contributions without running.

## Phase 5: User Story 3 — Run and Monitor (P2)

**Goal**: run pipelines/agent trees via embedded fabric runtime on
`EngineLike`; live progress, cancel, history.

**Independent Test**: run `notes-pack:document-summary` with objective →
live step events → artifacts + trace persisted; cancel mid-run; history
lists run; failed run surfaces located error.

- [x] T026 Create `src/bun/fabric/components.ts`: builtin deterministic
  components `text.concat`, `text.template`, `json.extract`, `list.map`,
  `list.filter`, `const` (D6) + `runPromptComponent` executing
  `runtime:prompt` skills via injectable `EngineLike` (template render,
  validated JSON/text outputs).
- [x] T027 [P] `tests/fabric/components.test.ts`: each builtin's port
  contract; prompt component renders `{params.x}`/`{inputs.x}`/`{objective}`
  and validates outputs (fake EngineLike).
- [x] T028 Create `src/bun/fabric/pipeline.ts`: topological DAG executor —
  port binding, param resolution, step trace emission, abort-aware.
- [x] T029 Create `src/bun/fabric/agent.ts`: agent-tree runner — `router`
  supervisor emits validated JSON delegation plan (existing agents,
  `@d1` refs, acyclic), `sequential` chains children, `llm`/`planner` leaf
  calls, `pipeline` node delegates to T028; budget enforcement
  (maxDepth/maxDelegations/maxModelCalls).
- [x] T030 Create `src/bun/fabric/runtime.ts`: `RunWorker` — async-gen
  run loop emitting `TraceEntry`s, `AbortSignal` → `engine.stop()`,
  persists `RunRecord` to `runsDir`, 50-run cap per pack, terminal states
  only after `endedAt` (SC-006); hook for `disable` to abort active runs.
- [x] T031 [P] `tests/fabric/pipeline.test.ts` + `agent.test.ts`: DAG
  order/bindings; router plan validation rejects unknown agents/cycles;
  budget caps terminate; abort mid-step → `cancelled`.
- [x] T032 [P] `tests/fabric/runtime.test.ts`: run→trace→persist; 50-cap
  pruning; disable aborts in-flight run; failed component → `failed` run
  with located error.
- [x] T033 `src/bun/rpc/handlers.ts`: `run.start` (`ENGINE_BUSY` while chat
  generating — v1 serializes with chat), `run.cancel`, `run.list`,
  `run.get`, `run.clear`; emit `run.event`/`run.status`; wire
  `EngineLike` + roles for model resolution (FR-018). Bidirectional busy
  guard (I2 fix): `chat.send`/`chat.regenerate`/`chat.edit` (and fusion
  entrypoints) MUST reject with `ENGINE_BUSY` while a fabric run is active
  — serialization must hold in both directions or KV/engine state
  interleaves.
- [x] T034 [P] `tests/rpc/runs.test.ts`: start/cancel/list/get over RPC;
  `ENGINE_BUSY` when generating; `chat.send` during an active run →
  `ENGINE_BUSY` (I2); events emitted per step; run.clear count.
- [x] T035 `src/renderer/src/features/fabric/RunView.tsx` NEW: objective +
  params form (≤3 clicks from browser, SC-003), live step list fed by
  `run.event`, cancel button, artifacts panel.
- [x] T036 `src/renderer/src/features/fabric/RunHistory.tsx` +
  `TraceView.tsx`: per-pack run list; trace path rendering
  (`lead/team/worker`), per-step I/O, error display.

**Checkpoint**: end-to-end run on fixture pack with fake/local engine.

## Phase 6: User Story 4 — Extension-Contributed UI (P3)

**Goal**: pack-shipped static views render in isolated `BrowserView` slots
with narrow `ext.*` bridge; crash containment; theme push.

**Independent Test**: views-pack renders in slot; crash-view-pack contained
to error placeholder + reload works; undeclared capability call →
`CAPABILITY_DENIED`; theme change reaches view.

- [x] T037 Create `src/bun/extensions/bridge.ts`: `createViewRpc(pack)` —
  `defineElectrobunRPC` schema with only `ext.*` methods (`context`,
  `storage.get/set/remove` scoped to `packDataDir`, `runs.list/get` own
  pack, `invoke`, `models.generate` via `EngineLike`); per-call capability
  check → `CAPABILITY_DENIED` (FR-014); host→view events
  `ext.themeChanged`, `ext.runUpdated`, `ext.contextChanged`.
- [x] T038 Create `src/bun/extensions/views.ts`: `ViewManager` —
  `open`/`close`/`setBounds` over `BrowserView` (per-pack `partition`,
  `viewsRoot` = view dir, `allowedProtocols` locked to view assets, D2);
  injectable `BrowserView` factory for tests; crash → destroy + error
  state; disable/remove destroys sessions (FR-016 reload path).
- [x] T039 Create `src/bun/extensions/preload.ts` (view-side bridge preload,
  host-shipped): exposes `window.ext` async methods + `on(event)` — only
  surface pack JS sees (contracts/view-bridge.md).
- [x] T040 [P] `tests/extensions/bridge.test.ts`: capability gating per
  method; storage scoped to pack dir; `runs.list` returns own pack only;
  `models.generate` routes through fake EngineLike.
- [x] T041 [P] `tests/extensions/views.test.ts`: open/close/setBounds via
  fake BrowserView factory; partition per pack; disable destroys sessions;
  crashed view recreates on retry.
- [x] T042 `src/bun/rpc/handlers.ts`: `view.open/close/setBounds` handlers;
  `ViewManager` dep; emit view error events.
- [x] T043 `src/renderer/src/lib/ext-view-host.ts` + slot component
  `ExtensionViewSlot.tsx`: reports slot rect via `view.setBounds`, renders
  error placeholder + Reload on view crash; mount contributed views as
  tabs/panels from `pack.contributions`.
- [x] T044 `src/renderer/src/features/extensions/`: theme change →
  `ext.themeChanged` dispatch when pack declares `views.theme` (FR-015);
  `views-pack` fixture `views/explorer/index.html` +
  `crash-view-pack` (throws on load) in `tests/extensions/fixtures/`.

**Checkpoint**: extension view live in window, isolated, themed.

## Phase 7: Polish & Cross-Cutting

- [x] T045 `specs/017-multi-agent-plugin-ui/validation.md`: map FR-001..020
  + SC-001..007 to tests/code paths (spec 016 convention).
- [x] T046 Quickstart manual pass: all 6 scenarios in `quickstart.md` on a
  real build; record deviations.
- [x] T047 [P] `AGENTS.md`: add feature-017 module-map section (fabric,
  extensions, bridge, views; gotchas: all-or-nothing registration,
  declarative-only packs, ENGINE_BUSY serialization).
- [x] T048 Gates: `bun test ./tests`, `bun run typecheck`, `bun run lint`,
  `bun run build:renderer` green.

## Dependencies & Execution Order

- Phase 1–2 block everything (schema, parser, registry).
- US1 (T010–T018) depends on Phase 2; blocks US2/US3 (need enabled packs)
  and US4 (lifecycle owns view sessions).
- US2 (T019–T025) depends on US1 store/registry; blocks US3 (targets come
  from contributions).
- US3 (T026–T036) depends on US2 contribution descriptors.
- US4 (T037–T044) depends on US1 only — can run parallel to US2/US3.
- Polish last.

### Parallel opportunities

- T002/T003, T005/T007, T012/T013/T016 — independent files.
- US4 (T037–T041 main-side) can parallel US2+US3 after US1 lands.
- T021/T023, T031/T032/T034, T040/T041 — test files independent.

## Implementation Strategy

**MVP**: Phase 1–3 (US1) — install/enable/disable packs with consent +
contribution registration, demonstrable via RPC before any UI. Then US2
(browse) → US3 (run, the largest chunk) → US4 (isolated views).

## Notes

- Zero new dependencies throughout (`Bun.YAML`, `DecompressionStream`,
  Electrobun `BrowserView`, existing `EngineLike`).
- Packs are declarative — no pack code executes; `runtime:component` ids
  are host builtins only.
- Extension views are real `BrowserView`s, not iframes.

## Phase 8: Convergence

- [x] T049 Implement structured contribution detail views per T025 + US2/AC1-2 (partial): `SkillDetail` (typed ports, params, guidance sections), `PipelineDetail` (step DAG with bindings), `AgentTree` (recursive hierarchy incl. kind/model/children) — wire as the detail pane in `WorkspaceBrowser.tsx`.
- [x] T050 Implement `TraceView` per T036 + US3/AC3 (partial): per-step input/output rendering and artifact values (not just names) in `RunView.tsx`.
- [x] T051 Wire extension-view crash reporting per US4/AC2 + T043 (partial): `EXT_PRELOAD_JS` captures `error`/`unhandledrejection` and reports to the host; host marks the session crashed (`markCrashed` → `view.error`) so `ExtViewHost` shows the contained placeholder + reload.
- [x] T052 Restrict extension-view navigation per FR-013/FR-014 (partial): set `navigationRules` on the extension `BrowserView` in `electrobun-view.ts` so only `views://` pack assets load (no remote navigation).
- [x] T053 Add a 3-pack simultaneous-enable coexistence test per SC-005 (partial).
- [x] T054 Add a `RunManager` 50-cap history-pruning test per T032 (partial).
- [x] T055 Honor the declared view `slot` per T043 + FR-013 (partial): `slot: "tab"` contributions open in a tab-style host surface rather than always the bottom `ExtViewHost` panel.
