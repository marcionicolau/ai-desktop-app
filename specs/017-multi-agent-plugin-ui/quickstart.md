# Quickstart Validation: Multi-Agent Workspace & Extension Plugins

Prerequisites: `bun install`, native shim built (`bun run build:native`), a
GGUF model in `models/`. Run dev with `bun run dev`. Fixture packs live in
`tests/extensions/fixtures/` (created by tasks).

## Gates (must pass)

```bash
bun run typecheck && bun run lint && bun test ./tests
```

## Scenario 1 — Install, consent, browse (US1, US2)

1. Extensions panel → Install → pick `fixtures/notes-pack` folder.
2. Expect pack listed with version, apiLevel, capabilities; consent dialog
   shows `models.generate` + `storage` on enable (FR-005).
3. Enable → Workspace shows `notes-pack:note_taker` agent, `summarize_notes`
   skill, `document_summary` pipeline — namespaced, no collisions (FR-006).
4. Inspect `summarize_notes`: typed inputs/outputs, guidance sections
   render read-only.

## Scenario 2 — Run a pipeline end-to-end (US3)

1. Workspace → `notes-pack:document_summary` → enter objective + sample
   transcript → Start (≤3 interactions, SC-003).
2. Watch `run.event` steps flip running→done; artifacts appear on finish.
3. Run history: reopen run → full trace path visible (`lead/worker` etc.).
4. Cancel mid-run on a second run → status `cancelled`, engine freed.

## Scenario 3 — Extension UI view (US4)

1. `fixtures/views-pack` ships `views/explorer/index.html`.
2. Open its tab → `ext.context()` returns packId+theme; `ext.storage.set`
   round-trips after view reload.
3. Switch host theme → view receives `ext.themeChanged` (FR-015).

## Scenario 4 — Fault containment (SC-002)

1. Install `fixtures/broken-pack` (bad frontmatter) → pack `failed` with
   located error; other packs + chat unaffected.
2. `fixtures/crash-view-pack` throws on load → only its slot shows error;
   reload button recreates the view (FR-016).
3. View without `storage` cap calling `ext.storage.get` →
   `CAPABILITY_DENIED` (FR-014).

## Scenario 5 — Remote install (FR-019/020)

1. `extension.install {kind:"url"}` against a `file://` `.tgz` of
   notes-pack → preview manifest → install → consent → enable.
2. Registry JSON pointing at the same `.tgz` → entry pick → same flow.
3. Oversized/corrupt archive → `ARCHIVE_INVALID`, nothing written.

## Scenario 6 — Lifecycle edge cases

1. Disable notes-pack mid-run → run aborted, status `cancelled`, trace
   kept (SC-006); contributions gone, no restart.
2. Re-enable → contributions back; run history preserved.
3. Restart app → enabled state persisted (FR-004).
4. Remove with `purgeData` → pack dir + runs deleted; storage gone.

## Expected coverage

`tests/fabric/` covers frontmatter validation, DAG order/port binding,
router delegation JSON validation, budget caps; `tests/extensions/` covers
scan/install/enable/remove, tar extraction (incl. traversal rejection),
capability gating; `tests/rpc/` covers handler wiring + events. All engine
calls use a fake `EngineLike` — offline suite stays offline.
