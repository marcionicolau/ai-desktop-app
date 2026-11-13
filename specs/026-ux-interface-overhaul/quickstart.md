# Quickstart: Validating the Interface Overhaul

Prereqs: `bun install`, a GGUF in `models/`, `bun run dev`.

## V0 — Baseline (before any change, slice S0)
Run the five-task walkthrough on `main` (start chat, switch model, change generation setting, import a file, delete a conversation). Record time and pass/fail per task in `validation.md`.

## V1 — Gate G0
Open `specs/026-ux-interface-overhaul/candidates/*.html` (light + dark). Owner records the chosen direction in `research.md` R1.

## V2 — Scales and contrast (S1, S6)
`bun test ./tests` → `ui-audit.test.ts` (scale/icon/native-control rules) and `ui-contrast.test.ts` pass. Expect 0 arbitrary font sizes, 0 native selects, icons imported only via `components/icons.ts`.

## V3 — Feedback (S2)
Trigger: a model load, a download, a failed import, delete conversation, an empty models list. Expect progress ≤ 200 ms, toast or inline result, recovery action on errors, named confirmation on delete, explanatory empty state.

## V4 — Navigation (S3)
Keyboard only: `Ctrl/Cmd+K` → open a conversation by name → `Ctrl/Cmd+N` → switch model → open settings. Focus ring visible throughout; no keyboard trap; breadcrumb/title shows location.

## V5 — Forms (S4)
Generation settings: slider shows value/unit/range and accepts typed input; invalid value shows inline message without losing input; unsaved change warns on navigation.

## V6 — Responsive, density, preferences (S5)
Resize 800 × 600 → large in both themes and both densities: no clipping/horizontal page scroll; chat line length capped. Toggle OS reduced-motion and increased-contrast: animation off, contrast tokens active. Switch density: spacing changes everywhere and persists across restart.

## V7 — Accessibility (S6)
axe-core pass on every surface in both themes (0 serious/critical); manual screen-reader pass on one OS covering chat send/receive announcements and an error toast.

## V8 — Gates
`bun run typecheck`, `bun run lint`, `bun test ./tests`, `bun run build:renderer`; repeat the walkthrough and record results (SC-002, SC-004).
