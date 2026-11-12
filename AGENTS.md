# AGENTS.md

Electrobun 2.x + Bun desktop AI chat app (local llama.cpp via `bun:ffi`).

## Commands

| Task | Command |
|------|---------|
| Dev (window + HMR) | `bun run dev` — `hutch dev` → vite :5173 + `electrobun dev --watch` |
| Canary package | `bun run build` — `hutch run build` → `electrobun build --env=canary` → `build/canary-<platform>/` |
| Stable package | `bun run build:stable` |
| Native libs | `bun run build:native` → `native/out/<platform>/` |
| Typecheck | `bun run typecheck` (tsc strict) |
| Lint | `bun run lint` (oxlint) |
| Test | `bun test ./tests` — MUST be scoped; unscoped `bun test` picks up vendored llama.cpp tests |
| Renderer build | `bun run build:renderer` (vite → `dist/renderer`) |

Notes:

- Use `hutch run <script>` for scripts in `hutch.config.ts` — bare `hutch
  build` is a Hutch built-in that forwards to `bun build`, not the scripts map.
- Package manager is Bun (`bun install`, `bun.lock`); `hutch install` uses a
  different resolver — avoid.
- TypeScript resolves `electrobun/*` via `.hutch/devkit` (projected by
  `bun x electrobun prepare`; regenerate after toolchain bumps).
- `.hutch/dependencies.lock` is committed; `.hutch/devkit/`, `.hutch/locks/`,
  `build/`, `native/out/`, `models/` are ignored.

## Architecture (one-liner)

`src/bun` (main process: window, typed RPC handlers, llama FFI engine, JSON
store) ↔ `src/shared` (RPC contract + domain types) ↔ `src/renderer` (React +
Tailwind v4 + shadcn via Vite) ; `src/native/shim` = pull-based C ABI over
vendored llama.cpp. Feature docs under `specs/`.

## Commit convention

Spec Kit hooks only fire at command boundaries (no per-task hook event).
Convention: commit after each completed task or small task group during
implementation via
`.specify/extensions/git/scripts/bash/auto-commit.sh <phase> --message-file <f>`
with a conventional-commit message.

## Module map (feature 003)

Main process (`src/bun/`):

- `llama/prompt.ts` — pure ChatML/plain prompt assembly + token-budgeted
  history truncation (`buildPrompt`, injectable `costOf`).
- `llama/params.ts` — `GenerationParams` merge/validate + `packParams` into
  the 32-byte `lls_gen_params` FFI struct.
- `llama/ffi.ts` — `dlopen` symbol surface incl. `lls_generate_continue`,
  `lls_token_count`, `lls_gguf_meta` (FFI ptr returns `null`, not `0`).
- `models/library.ts` — `models/` scan + `readGgufMeta` (header-only GGUF
  parse via shim); `MODELS_DIR` env override for tests.
- `rpc/handlers.ts` — all RPC incl. `chat.regenerate`/`chat.edit` (shared
  `streamAssistant` driver), `model.list`/`model.download`/`model.setOverride`.
- `store/json-store.ts` — `Settings.generation` + `modelOverrides`,
  `deleteMessagesAfter` primitive.

Native (`src/native/shim/`): `lls_gen_params` sampler chain (greedy when
`temperature<=0`), KV token mirror + longest-common-prefix reuse
(`lls_generate_continue`, `2` = full-decode fallback), `lls_gguf_meta`.

Renderer (`src/renderer/src/`): `components/ai/` (markdown `AiMessage`,
`CodeBlock` copy, `MessageActions`), `features/settings/GenerationSettings`,
`features/models/ModelLibrary` (download form + per-model overrides).

## Module map additions (feature 004 — roles & fusion)

Main process (`src/bun/`):

- `models/roles.ts` — `RolesService`: tag CRUD (slug-validated), bind/unbind,
  ordered fallback chains (max 3, transitive cycle check, lazy file refs),
  `resolve()` first candidate + `resolveCandidates()` full ordered list,
  param cascade `DEFAULT < global < file-override < tag`, `default` tag
  synced bidirectionally with `activeModelPath`.
- `models/registry.ts` — `ModelRegistry`: `Map<path, ModelSlot>`, shared
  slots across roles (same file = one native instance), `MAX_SLOTS=2` LRU
  eviction of non-busy slots, pin/release/stale lifecycle, injectable
  engine factory for tests; `createRegistryEngine` adapts it to `EngineLike`.
- `llama/plan-prompt.ts` — `buildPlannerPrompt` / `buildExecutorPrompt`
  (`<plan>` injection) for the two-phase turn.
- `llama/fusion.ts` — `runFusionTurn`: sequential plan → answer phases over
  candidate lists; retry next candidate on load/pre-token failure only;
  stop-at-boundary (partial plan ⇒ no answer phase); emits
  `chat.phase`/`chat.token{phase}`.

RPC additions: `role.list/create/update/delete/bind/setFallback/resolve`,
`conversation.setMode` (fusion gating → `ROLE_UNBOUND` names the missing
role), `chat.send` accepts `mode/plannerTag/executorTag` at creation,
events `chat.phase`, `chat.token{phase}`, `chat.done.stats{plan,answer,total}`,
`role.changed`.

Renderer additions: `features/roles/` (`use-roles`, `RolesPanel`,
`TagEditor`, `FusionControls`); `use-chat` reducer is phase-aware
(plan tokens → `phases.plan.content`, `servedBy` badges).

Gotchas:

- ChatML literals in `prompt.ts` are deliberately split (`"<" + "|im_...|>"`)
  because the edit toolchain strips the literal tokens — do not merge them.
- `chat.send` accepts `userMessageId` so optimistic renderer ids match the
  store; required for `chat.edit` to find fresh user messages. `chat.edit`
  accepts the same param for its new user variant (feature 005).
- Runtime fallback cascades retry only *before* the first emitted token —
  mid-stream failures propagate so output never duplicates.

## Module map additions (feature 005 — conversation branching)

Main process (`src/bun/`):

- `store/tree.ts` — pure ops over flat `messages[]`: `pathOf`, `siblings`,
  `children`, `deepestLeaf`, `variantIndex`, `pathToLeaf`, `leafOf`.
  Variant set = same `parentId`; displayed path = ancestors of
  `Conversation.activeLeaf`.
- `store/json-store.ts` — `backfillTree` lazy migration: ABSENT `parentId`
  → linear chain; explicit `null` is a real root marker and is preserved.
- `rpc/handlers.ts` — `chat.regenerate`/`chat.edit` now append siblings
  (no in-place reset, no tail splice; `deleteMessagesAfter` is off the
  edit path but stays exported for tests/cleanup); history = `pathOf`
  ancestors, so dead variants never reach the model; new
  `message.selectVariant` (`activeLeaf = deepestLeaf(target)`,
  `ENGINE_BUSY` mid-turn).

Renderer (`src/renderer/src/`): `features/chat/tree.ts` (client mirror),
`VariantNav` (‹ n/m › picker), `BranchOverview` (fork list), `use-chat`
keeps flat messages + `activeLeaf` and derives `path`/`variants`/
`branches` locally.

Gotcha: sibling semantics mean `chat.regenerate`/`chat.edit` return NEW
message ids — callers must re-target follow-ups to the returned id.

## Module map additions (feature 008 — export/import)

Shared (`src/shared/`): `export.ts` — one versioned envelope for both
scopes: `{formatVersion:1, app, kind:"conversation"|"backup", exportedAt,
conversations[], settings?, tags?}`; `ExportedConversation` is `Conversation`
verbatim so trees/phases round-trip; `ExportedSettings` stores
`activeModel` as a **basename** (no absolute paths leave the machine).

Main process (`src/bun/`):

- `export/exporter.ts` — `buildEnvelope`/`buildBackupEnvelope`,
  `renderMarkdown` (active path via `pathOf`, `*(variant k of N)*` markers,
  plan phases as `<details>`), `slugify`/`uniqueFileName` (`<slug>-<id8>.ext`,
  `-2` dedup).
- `export/importer.ts` — `parseEnvelope` validates EVERYTHING before any
  write (`INVALID_PARAMS`, zero partial writes); `remapConversation` mints
  fresh ids for conv + all messages and rewrites `parentId`/`activeLeaf`
  through the map (dangling refs → null); `toSettings` resolves basename
  → path only if the file exists, absent bindings stay bound (`broken`).
- `rpc/handlers.ts` — `conversation.export`/`conversation.import`/
  `backup.export`/`backup.import`. New injectable `dialogs` dep
  (`pickFolder`/`pickFile` over `Utils.openFileDialog`); absent dep = treat
  as cancelled so headless tests stay safe. Electrobun 2.x has NO save
  dialog: exports pick a folder and write a deduped filename into it;
  `null` responses mean cancellation.

Renderer: `Sidebar` has an inline Download icon (format-choice dialog) +
an Import button; `DataPanel` under settings does full backup export/
restore.

## Feature 009 — context file attachments

- `attachments/store.ts` — `pickAndStore(paths)` validates (binary/UTF-8/≤2 MiB
  read cap) + persists `{id, path, fileName, sizeBytes, content}` JSON under
  `dataDir()/attachments/`; content NEVER crosses the RPC boundary (renderer
  gets metadata only); `byPath` dedup on resolved path; `resolveMany` /
  `readAttachment` / `gcFor` (unlink files whose ids a deleted conversation
  was the last referrer of).
- `attachments/inject.ts` — `buildBlocks` emits `<file name="…">…</file>`
  appended to the current user turn (buildPrompt budgets it ahead of history
  for free); `fitBudget` truncates at line boundaries + `… [truncated]`,
  marks rest `excluded`; `plannerSummary` gives fusion planners names/sizes
  only while the executor gets full blocks (`plannerText` on `runFusionTurn`).
- `rpc/handlers.ts` — `attachment.pick` uses `dialogs.pickFiles` (multi-select
  `Utils.openFileDialog`, falls back to `pickFile`); `chat.send` accepts
  `attachmentIds` (unknown id → `INVALID_PARAMS`), stores status records on
  the user message, emits `chat.warning` code `ATTACHMENTS_BUDGET`;
  `chat.regenerate` re-resolves the original ids → identical reinjection;
  `conversation.delete` → `gcFor`.
- `store/paths.ts` — `APP_DATA_DIR` env is read live per call (tests set it
  per-file); only the Electrobun/fallback resolution is cached.

Renderer: `Composer` paperclip → `attachment.pick` → removable name/size chips
draft-side; `MessageList` renders `Message.attachments` chips (`·trunc` /
`·skipped` styling) on user messages.

## Feature 011 — model advisor

- `advisor/benchmark.ts` — bounded run: fixed prompt, 128 tok / 25 s caps,
  RSS sampled every 250 ms (`peakBytes` floored at file size); loads the
  target via the single-flight engine and restores the previous model.
- `advisor/verdicts.ts` — pure math, memory injected: `headroom` (max
  1 GiB/15%), `fitVerdict` (fits/tight/wontfit), `kvPerToken` (measured
  peak − file size, 256 KiB/tok fallback), `recommendedCtx` (pow2 floor,
  contextTrain cap), `fusionFit` (seq peak = max, combined = sum).
- `advisor/store.ts` — `benchmarks.json` in dataDir, fingerprint =
  `fileName:sizeBytes`; tolerant load (corrupt → {}).
- `model.benchmark` — `ENGINE_BUSY` while generating/benchmarking; emits
  `model.progress` with `detail: "benchmarking"`. `model.advise` — pure
  live call, `basis` is `measured` only with a fingerprinted record.
- `models/library.ts` — `scanModels` tolerates a missing shim (null metas).

## Feature 006 — personas & prompt presets

- `personas/service.ts` — settings-resident CRUD (`settings.personas` /
  `settings.snippets`); seed-on-read (`undefined` → starters, `[]` stays
  empty); delete clears `Conversation.personaName` and returns `cleared`;
  personas + snippets share the `/`-picker namespace (collision check).
- `prompt.ts` — `buildPrompt` `system` opt: charged first, always kept,
  hard-truncated only if it alone overflows; renders `im_start|system`
  (ChatML) / `System: …` (plain).
- Cascade is `DEFAULT < global < persona < modelOverride < tag` — persona
  is the optional 3rd arg on `roles.resolveCandidates`/`resolve`; fusion
  passes it (and `executorSystem`) to the executor only (FR-009).
- `conversation.setPersona` returns `{suggestedTag}`; the renderer offers
  to re-bind (single → `model.load`, fusion → executor tag pick), hidden
  when the tag is unbound. Draft conversations stash the pick in
  `pendingPersona` until `chat.send` creates the record.
- UI: header persona `<select>` + sidebar `personaName` badge +
  `PersonasPanel` (CRUD incl. snippets) + Composer `/` picker.

## Feature 007 — conversation search

- `bun/search/index.ts` — in-memory `SearchIndex`; lazy refresh keyed on
  each conversation's `updatedAt` (rebuilds transparently from JSON on
  restart; nothing persisted). Literal case-insensitive substring, all
  terms AND'd; `generating`/`failed` excluded; 20 groups × 3 hits.
- RPC `search.query` → `{groups}`; hit carries `snippet` +
  `matchStart`/`matchEnd` for renderer `<mark>` highlighting; title-only
  matches surface as `{titleMatched, hits:[]}`.
- Index freshness depends on `updatedAt` — every mutation (incl.
  `chat.done`/`chat.error` persists) must bump it.
- Renderer: Sidebar search box (≥3 chars flips to results, 250 ms
  debounce, seq-guard for stale responses, `<3` = title filter); hit
  click → `selectConversation(cid, mid)` → `scrollTarget` →
  `MessageList` `scrollIntoView` + 2 s ring flash.

## Feature 010 — KV-state persistence

- `kv/store.ts` `SnapshotStore` — manifest `index.json` + `.kv` blobs
  under `dataDir()/kv`; write protocol = shim `.tmp` → rename →
  `store.save()`; ctor sweeps torn `.tmp` + orphan blobs + blob-less
  entries. `policy` is synced from `settings.snapshot` per call
  (`DEFAULT_SNAPSHOT_POLICY` = on, 2 GiB).
- `modelFingerprint(path)` = `path|size|sha256(head64K‖tail64K)` — no
  cache; `lookup` also gates on `ctxSize`.
- Engine: `generate` opts `{conversationId, roleKey, snapshot}`;
  `tryRestore` on cold slot → `lls_generate_continue` LCP-resumes;
  auto-`saveState` in the finally. `roleKey` = `main|planner|executor`
  (fusion passes it through `genPhase`).
- Shim: `lls_state_save/load` wrap `llama_state_*_file`; **load must
  repopulate `kv_tokens` + `pos`** or continue-LCP breaks. `ffi.ts`
  dlopens with state symbols, falls back to base set on stale shim —
  snapshot layer no-ops then.
- `ModelRegistry` 3rd ctor arg `onEvict(slot)` → FR-008 disk offer.
- `snapshot.stats`/`snapshot.clear` RPC; `deps.snapshots` absent ⇒
  feature off (tests).

## Feature 016 — output stats panel

- `metrics/store.ts` `MetricsStore` — session-only ring (500 cap,
  oldest dropped); `record` assigns id+ts, `clear` returns `{removed}`.
- `MetricEntry` (shared/types): modelFile (serving model, fallback
  aware), roleKey `main|planner|executor`, tag/personaName,
  prompt/outputTokens, elapsedMs, warm, status
  `complete|partial|failed`, fallback flag, ≤120-char promptPreview.
- Collection point = `recordCall` in `rpc/handlers.ts` — gated on
  `settings.outputPanel` (off ⇒ zero entries, zero overhead); records
  success and `status:"failed"` from catch paths (`recFail` guarded by
  `recorded` so one call = one entry). Fusion phases report via
  `runFusionTurn`'s `onMetric` (one entry per phase; handlers add
  personaName so fusion.ts stays persona-agnostic).
- `engine.generate` result gained `promptTokens` — real count via
  `lls_token_count` on the built prompt; `EngineLike.promptTokens?`
  optional (fakes omit). `genPhase` forwards `promptTokens`/`warm`.
- RPC: `metrics.list`, `metrics.clear`; `settings.get` returns
  `outputPanel` (default false), `settings.set` persists it; live push
  via `metrics.entry` event.
- Renderer: `features/metrics/OutputPanel.tsx` — bottom sibling under
  Composer in ChatPage's flex-col (pushes messages up, never overlays);
  model tabs + role→persona groups + Clear; header checkbox toggle.

## Feature 015 — sandboxed local tool use

- Convention: ```` ```tool_call ```` fenced block with one JSON
  `{tool,path}`; `read_file`/`list_dir` only. Results re-enter the stream
  as ```` ```tool_result ```` blocks (visible + prompt context).
- `shared/tool-call.ts` — pure parser: `scanBlocks` (spans for renderer
  splitting + loop detection), `parseCallBody`, `renderResultBlock`.
- `tools/sandbox.ts` — realpath root + containment (`isWithin`); relative
  resolves under root, absolute must stay inside; missing-in-root file →
  tool error, NOT refusal.
- `tools/executor.ts` — read_file/list_dir, 8 KiB byte cap with UTF-8
  boundary fix, `\n…[truncated]` marker.
- `tools/service.ts` `ToolService` — policy from `settings.tools`
  (`{sandboxRoot, mode: ask|allow-read-session|deny}`); `autoApprove` =
  mode allow-read-session OR per-conversation `grants` (in-memory only);
  `awaitDecision` deferral resolved by `tool.respond`/`discardPending`.
- `tools/loop.ts` `runToolLoop(eng, prompt, opts)` — the turn driver:
  stream → complete call block → `eng.stop()` → verdict → (pending →
  deferred decision) → execute → inject result → `generate` continues on
  the KV prefix. `TOOL_BUDGET = 5`; on cap → `TOOL_BUDGET` warning +
  `disarmed` (later blocks get inert `refused/budget` records). Continuation
  ctx-overflow → `elideResults` once (old `tool_result` bodies become
  markers) then cold re-prefill. Pending calls register `awaitDecision`
  BEFORE `onCall` emits — a respond inside emit must find the map entry.
- `tools/audit.ts` — append-only `dataDir()/tool-audit.jsonl`, one line
  per executed/errored call; refusals/denials never audit.
- Handlers: `turnBusy()` = `engine.isGenerating() || activeMessageId` —
  approval pauses still gate sends/regens. `chat.stop` → `discardPending`
  then engine stop. `tool.respond`/`tool.pickRoot`/`settings.tools` in
  the contract; `chat.warning` code `TOOL_BUDGET`.
- Prompt: `composeSystem(persona, toolsActive)` appends
  `TOOL_INSTRUCTIONS` only when `service.active() && sandbox() !== null`
  — deny/unset ⇒ byte-identical prompt.
- Fusion: `genToolPhase` in fusion.ts mirrors `genPhase` budgeting but
  runs the executor's answer inside `runToolLoop`; planner output is
  never scanned (planner blocks stay inert plan text).
- Renderer: `ToolSegments`/`ToolCallCard` split `m.content` on fences;
  records zip tool_call blocks by index; pending → Approve / Allow reads
  this session / Deny via `tool.respond`. `tool.update` reducer action
  upserts by call.id. `settings/ToolSettings.tsx` — root picker + mode.

## Feature 017 — multi-agent workspace & extension packs

- Declarative packs only (`pack.yaml` + `SKILL.md`/`AGENT.md` frontmatter =
  contract, body = guidance); no pack code runs in the host. Runtimes:
  `prompt` (LLM-derived declared outputs) or `component:<builtin>` from the
  fixed `BUILTIN_COMPONENTS` set (`const`, `text.concat`, `text.template`,
  `json.extract`, `list.map`, `list.filter`).
- `src/shared/pack-schema.ts` — `PackManifest`, `Capability` closed enum,
  `ViewDecl`/`CommandDecl`/`PortDecl`/`ParamDecl`, `API_LEVEL = 1`.
- `bun/fabric/` — `errors.ts` (located `PackError`/`FabricError`),
  `frontmatter.ts` (`Bun.YAML` parse + located validation; steps must be
  topologically ordered — forward refs rejected), `registry.ts`
  (`ContributionRegistry`, all-or-nothing `registerPack`, `<packId>:<name>`
  namespacing, agent-tree cycle check), `components.ts` (builtins +
  `runSkill`/`runPromptComponent` over `ComponentEngine` = EngineLike
  subset + `stop?`), `pipeline.ts` (DAG executor, `$objective`/`$params.*`/
  `<stepId>.<port>` binding), `agent.ts` (router JSON plan + `@<id>` refs,
  sequential, llm/planner leaves, budget caps), `runtime.ts` (`RunManager`:
  abort→`engine.stop()`, live-map `get()`, 50-run persisted history).
- `bun/extensions/` — `store.ts` (`ExtensionsStore`: scan/install/enable
  (consent-gated)/disable/remove; `scan()` re-registers enabled packs —
  cold-start, FR-004), `fetch.ts` (folder/archive/.tgz via
  `DecompressionStream` + hand-rolled tar, url/registry fetch;
  traversal-safe, 64 MiB/2000-file caps), `bridge.ts`
  (`createViewBridge` → capability-gated `ext.*` handlers, pack-scoped
  kv.json storage, own-pack runs), `views.ts` (`ViewManager` + injectable
  `ViewFactory`; `emitToPack`, `pushTheme` gated on `views.theme`),
  `preload.ts` (`EXT_PRELOAD_JS` → `window.ext` over the host bridge),
  `electrobun-view.ts` (production factory; Electrobun imports are
  `require()`-deferred so handlers stay testable headless).
- RPC: `extension.scan/install/preview/enable/disable/remove`,
  `pack.contributions/readSpec`, `run.start/cancel/list/get/clear`,
  `view.open/close/setBounds`; events `extension.changed`, `run.event`,
  `run.status`, `view.error`. Consent lives on `enable`, not `install`.
- `turnBusy()` = `engine.isGenerating() || activeMessageId || fabric.isRunning()`
  — `ENGINE_BUSY` is bidirectional: chat rejects during runs, `run.start`
  rejects during chat (I2).
- Renderer: `features/extensions/` — `ExtensionsPanel` (lifecycle +
  consent UI), `WorkspaceBrowser` (contributions + commands as runnable
  shortcuts), `RunView` (history + live trace + cancel), `ExtViewHost`
  (native-view slot; ResizeObserver → `view.setBounds`; crash placeholder
  + reload). Toggled via the Puzzle header button.
- Gotchas: view `setBounds` needs `ffi.request.resizeWebview` (not in
  public entries — devkit-relative import, isolated in
  `electrobun-view.ts`); `install` on an existing pack = replace +
  revalidate + consent re-prompt when capabilities change; extension
  BrowserViews are non-sandboxed but their rpc is a dedicated
  `ExtViewRpcSchema` — `ext.*` is the only reachable surface.

## Feature 019 — workspace tabs

- `features/workspace/` (renderer): `WorkspaceAccordion` root (owned by
  `ChatPage` — a slot inside its column wrapping the chat block as the
  chat item's content), `use-workspace-items` hook +
  `tab-model.ts` pure `deriveTabs`/`reconcile` (headless-tested;
  reconcile auto-selects fresh ext tabs, falls back to `"chat"` when the
  selected tab vanishes; the hook seeds baseline from the first scan so
  restored tabs never steal focus).
- Hidden ext tabs stay mounted; `ExtViewHost` gained `visible`/`bare`/
  `onCrash` — `visible=false` → `view.setVisible` parks the native view
  offscreen (`setBounds` to `x:-10000`, Electrobun BrowserView has no
  `setVisible`), sessions open lazily on first selection (spec A8).
- RPC: `view.setVisible` → `ViewManager.setVisible` (park/no-op show).
- `ExtensionsPanel.afterEnable` = browse-only (A7); `ChatPage
  onOpenTabView` routes Browse→Open for `tab` views to `focusView`
  (single session, FR-013) while `panel` views keep the drawer host.
- Linux file dialogs go through `zenity` via `Bun.spawn` (native
  `Utils.openFileDialog` can hang the whole main proc under Wayland);
  `AI_DESKTOP_NATIVE_DIALOGS=1` forces the native path. Renderer RPC
  default timeout is 30 s (`maxRequestTime`) with `Infinity` for
  dialog/download calls.

## Feature 020 — workspace accordion UX

- The horizontal `TabBar` was replaced by `components/ui/accordion.tsx`
  (shadcn wrapper over `@radix-ui/react-accordion`,
  `type="single" collapsible={false}` → tab semantics, free roving
  keyboard nav). Item headers carry the 019 affordances (tooltip, crash
  `●`, ×→disable as an absolutely-positioned real button — trigger is a
  `<button>`, no nesting).
- Sizing animation = `transition-[flex-grow]` on `AccordionItem`
  (`data-[state=open]:grow`), NOT the docs' `--radix-accordion-content-
  height` keyframes — those measure intrinsic scrollHeight and break
  fill-layout regions (chat/extension views occupy all free space).
  `motion-reduce:transition-none` honors reduced motion.
- `AccordionContent forceMount` keeps collapsed chat/extension surfaces
  mounted (React state + BrowserView sessions alive); `visible` prop →
  `view.setVisible` still parks the native view on collapse.

## Feature 021 — AI UI modernization (sidebar shell + ai-elements)

- `components/ui/`: **only** place `@radix-ui/*` may be imported. Vendored
  primitives: accordion, alert-dialog, breadcrumb, badge, button, card,
  collapsible, dropdown-menu, input, kbd, progress, scroll-area,
  separator, skeleton, textarea, tooltip, trace, sidebar (icon-rail only,
  localStorage + Ctrl/Cmd+B, no Sheet). `trace.tsx` = step-chain primitive
  (Trace/TraceStep/TraceCollapsible/TraceDot/TraceBadge) shared by plan
  phases, tool calls, and run views.
- `components/ai/`: ai-elements recipes — message, prompt-input
  (SuggestionChips), tool-call (Confirmation + Stack Trace), context
  (token chip), task/queue/subagent, file-tree, model-selector,
  code-block, message-actions, ai-message (typeset markdown).
- `tests/ui-audit.test.ts`: enforces the boundary — zero radix imports
  outside `ui/`, zero palette literals outside `ui/`, `ai/` deps only on
  `ui/`+`lib/`+`shared/`.
- Theme: `lib/theme.ts` resolves `Settings.themeMode`
  (light/dark/system, persisted via `settings.set`, absent→system),
  toggles `.dark` on `<html>`, and reports `resolvedTheme` (transient
  `settings.set` param — validated, not persisted) so main can
  `pushTheme` to extension views. Tokens live in `index.css` `:root`/
  `.dark` + `@theme inline`; semantic `--success/--warning/--info`.
  Fontsource variable fonts (Public Sans/Geist/JetBrains Mono) +
  `typeset.css` (shadcn typeset, `.typeset` scope, `.not-typeset` opt-out).
- Shell: `SidebarProvider` > `AppSidebar` (ConversationNav + Extensions
  group + footer surfaces incl. ThemeSettings) + `SidebarInset` (header
  w/ `SidebarTrigger` + tab title + `ModelSelector` pair in fusion).
  `Sidebar.tsx` was replaced by `ConversationNav.tsx` (list content
  unchanged); workspace accordion remains the main surface.
