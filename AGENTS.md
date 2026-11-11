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
