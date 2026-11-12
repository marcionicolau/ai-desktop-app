# Validation — 017-multi-agent-plugin-ui

## Requirement → test mapping

| Req | Verified by |
|---|---|
| FR-001 discovery + manifest | `parseManifest` tests (frontmatter.test.ts); fixtures parse capabilities + commands |
| FR-002 all-or-nothing validation | `ContributionRegistry > broken-pack → all-or-nothing`; `ExtensionsStore > broken-pack fails on install` (enable rejects, nothing registered) |
| FR-003 install/enable/disable/remove | `ExtensionsStore` lifecycle tests; `extension.* rpc > lifecycle` full round-trip incl. remove+purge |
| FR-004 persist state across restarts | `state persists across store re-instantiation`; cold-start `scan()` re-registers enabled contributions (I1) |
| FR-005 consent for capabilities | `enable without consent → consent required` (store + rpc); consent dialog in ExtensionsPanel |
| FR-006 namespacing | `same names in two packs do not collide`; `notes-pack registers … namespaced` |
| FR-007 contribution registry | `pack.contributions` returns namespaced skills/pipelines/agents + manifest views/commands |
| FR-008 workspace browser | `WorkspaceBrowser` groups contributions, renders commands as runnable `run.start` shortcuts (U1) |
| FR-009 start run | `run.start` → `RunManager.start`; `run.* rpc > start → events/status` |
| FR-010 progress + cancel | `run.event`/`run.status` asserts; `cancel mid-run → cancelled record, no orphan`; abort → `engine.stop()` |
| FR-011 run history | persisted `RunRecord` JSON under `runsDir`; `run.list`/`run.get`/`run.clear` round-trip |
| FR-012 located errors | `PackError{code,file,path}` throughout; `failed step → failed run with located error` |
| FR-013 view isolation | `ViewManager` per-pack `persist:ext-<id>` partition + `viewsRoot` locked to pack dir (views.test.ts) |
| FR-014 capability gate | bridge.test.ts: every `ext.*` method denies undeclared capability |
| FR-015 context/theme push | `ViewManager.pushTheme` only reaches `views.theme`-declaring sessions; `ext.runUpdated` on run status |
| FR-016 view reload | `reopen replaces the session (reload path)`; ExtViewHost crash placeholder + Reload |
| FR-017 host runtime | components/pipeline/agent/runtime suites (components, pipeline, agent, runtime test files) |
| FR-018 model via host layer | `ComponentEngine` = `EngineLike` subset; runs route through `deps.engine`, `roleKey: "fabric"` |
| FR-019 local + remote install | fetch.test.ts: folder copy, .tgz extract, `file://` URL, registry JSON → entry resolution |
| FR-020 remote consent | `extension.preview` returns manifest + warnings without installing; consent at `enable` |

## Success criteria

| SC | Result |
|---|---|
| SC-001 install→enabled pack < restart | RPC lifecycle test covers install→enable→disable→remove in one session |
| SC-002 fault containment | failed pack marked `failed`/rejected, others unaffected (`failed pack doesn't block others`) |
| SC-003 run start ≤3 clicks | WorkspaceBrowser Run button → `run.start` (objective optional, defaults to target id) |
| SC-004 live progress | `run.event` emitted per step; RunView subscribes |
| SC-005 ≥3 packs no cross-talk | namespacing tests (2 packs) + per-pack partitions/dirs; bridge scoping asserted |
| SC-006 no orphaned runs | `abortPackRuns` on disable/remove; abort→`engine.stop()`; `isRunning()` false after abort |
| SC-007 crash contained | `markCrashed` → `view.error` → contained placeholder + reload; host unaffected |

## Engine serialization (I2)

`turnBusy()` in handlers covers `engine.isGenerating() || activeMessageId || fabric.isRunning()` —
chat entrypoints and `run.start` reject `ENGINE_BUSY` in both directions
(`chat.send while a fabric run is active → ENGINE_BUSY`).

## Gates

- `bun test ./tests`: 370 pass / 0 fail (56 files)
- `bun run typecheck`: clean
- `bun run lint`: 0 errors (pre-existing warnings only)
- `bun run build:renderer`: green — `dist/renderer/assets/index-*.js` 756 kB (pre-existing chunk-size warning)

## Quickstart notes (T046)

Scenarios 1–6 are covered by automated tests above (lifecycle, malformed/
incompatible rejection, cold-start re-registration, namespaced coexistence,
pipeline run + progress/cancel/history, capability denial, engine
contention). The view-isolation scenario requires a live Electrobun window
(`bun run dev`); `ViewManager` behavior is covered headlessly against a
fake `BrowserView` factory — production factory wiring lives in
`electrobun-view.ts` (sandbox-equivalent: locked `viewsRoot`, per-pack
partition, `ext.*`-only RPC surface).
