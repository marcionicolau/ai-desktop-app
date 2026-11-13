# Validation: Interface Usability Overhaul

Records the before/after evidence for SC-001…SC-011. Entries marked
*owner* need a run in the real Electrobun window; everything else is
automated or code-verified.

## Walkthrough results (SC-002, SC-003, SC-004)

Script: `walkthrough.md`. Baseline run on `main` (T002), final run on the
feature branch (T065).

| #   | Date       | Build (baseline / final) | Time (s) | Keystrokes + clicks | Pass | Notes                   |
| --- | ---------- | ------------------------ | -------- | ------------------- | ---- | ----------------------- |
| 1   | 13-11-2026 | baseline                 | 10.5s    | 1                   | Ok   |                         |
| 2   | 13-11-2026 | baseline                 | 9.4s     | 4                   | Ok   | Wrong Characters showed |
| 3–6 | —          | baseline                 | —        | —                   | —    | *owner: complete baseline* |
| 1–6 | —          | final                    | —        | —                   | —    | *owner: T065*           |

## Success-criteria evidence map

| SC | Criterion | Evidence | Status |
|----|-----------|----------|--------|
| SC-001 | AA contrast + focus + keyboard on all surfaces, both themes | `tests/ui-contrast.test.ts` — every token pair asserted in light, dark, and `prefers-contrast: more` (passing); global `:focus-visible` ring + `ring-2 ring-ring` primitives; `jsx-a11y` oxlint rules enabled; axe pass (T063) and screen-reader pass (T064) | automated PASS; *owner: T063/T064* |
| SC-002 | 100% checklist pass, no task slower than baseline | walkthrough table above | *owner: T002 (rest of baseline), T065* |
| SC-003 | Reach named item < 5 s, < 3 keystrokes once palette open | palette opens with `Ctrl/Cmd+K`, conversations/models/settings are first groups; one keystroke to focus input + type | *owner: T065* |
| SC-004 | Before/after walkthrough recorded | baseline rows above | *owner: T065* |
| SC-005 | Zero values outside the design scales | `tests/ui-audit.test.ts` — `font-sizes`, `icon-sizes`, `icon-import-site`, `overlays`, `native-controls` all enforced, zero violations | PASS |
| SC-006 | No clipped/unreachable content across size matrix × themes × densities | layouts: sidebar auto-rail < 896 px, header/chat wrap, forms grid-collapse, no fixed widths | *owner: T061, T080* |
| SC-007 | Every > 200 ms action shows progress; every failure shows recovery | `action-inventory.md` — 40 actions across 13 surfaces, each row names progress + recovery pattern; `notify`/`confirm`/`Alert` implemented | PASS (code-verified) |
| SC-008 | All quality gates pass | `bun run typecheck`, `bun run lint`, `bun test ./tests`, `bun run build:renderer` — all green 2026-11-13 (tsc clean; oxlint warnings only; 592/592 tests; vite build 819 ms) | PASS |
| SC-009 | No old-look leftovers | Midnight palette/fonts/Remix applied app-wide; lucide/fontsource-old removed | *owner: T066* |
| SC-010 | Conversation ≥ 40% of height at 800 × 600 with Metrics open | `ChatColumn` vertical split: conversation min 40%, metrics 10–50% (default 25%) | code-verified; *owner: T080* |
| SC-011 | Mode, model(s), persona each selectable in exactly one place | `ChatSetup` header cluster is the only mode/model/persona control; `FusionControls` deleted | PASS |

## Performance notes (T060)

Measured 2026-11-13 (Bun, linux-x64, synthetic corpus):

| Measurement | Result | Budget |
|-------------|--------|--------|
| `search.query` cold index build — 500 convs × 20 msgs (10k entries) | 42 ms | ≤ 100 ms ✓ |
| `search.query` warm (incremental refresh) | 1–3 ms | ≤ 100 ms ✓ |
| Palette title filter, 500 items (substring per keystroke) | 0.2 ms | ≤ 100 ms ✓ |

Result sets are bounded server-side (20 groups × 3 hits) and the
conversation scroll list renders ~500 plain rows in a `ScrollArea` —
no virtualization needed at this scale. Sidebar menu rows are real
`<button>`s, so lists stay keyboard-navigable.

## Resize matrix (SC-006) — T061 *owner*

| Size | Theme | Density | Result | Notes |
|------|-------|---------|--------|-------|
| 800 × 600 | light | comfortable | — | *pending* |
| 800 × 600 | dark | comfortable | — | *pending* |
| 800 × 600 | light | compact | — | *pending* |
| 800 × 600 | dark | compact | — | *pending* |
| 1024 × 720 | light | comfortable | — | *pending* |
| 1024 × 720 | dark | comfortable | — | *pending* |
| 1024 × 720 | light | compact | — | *pending* |
| 1024 × 720 | dark | compact | — | *pending* |
| 1440 × 900 | light | comfortable | — | *pending* |
| 1440 × 900 | dark | comfortable | — | *pending* |
| 1440 × 900 | light | compact | — | *pending* |
| 1440 × 900 | dark | compact | — | *pending* |
| 1920 × 1080 | light | comfortable | — | *pending* |
| 1920 × 1080 | dark | comfortable | — | *pending* |
| 1920 × 1080 | light | compact | — | *pending* |
| 1920 × 1080 | dark | compact | — | *pending* |

## Accessibility passes — T063/T064 *owner*

- axe-core (both themes, every surface): *pending*
- Screen reader (chat send/receive, error toast): *pending*

## Old-look leftover check — T066 *owner*

Side-by-side review vs pre-change screenshots: *pending*

## Minimum-size note — T080 *owner*

Electrobun `BrowserWindow` has no minimum-size API (R7) → 800 × 600 is a
tested floor (`docs/window-size.md`). Measured conversation-area share at
800 × 600 with Metrics open: *pending*
