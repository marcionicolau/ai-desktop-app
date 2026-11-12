# Quickstart: Workspace Accordion — Validation Guide

## Prerequisites

- `bun install` (adds `@radix-ui/react-accordion`); dev run: `bun run dev`
- Fixture packs enabled: `views-pack` (tab view), `notes-pack` (no views → pack tab), `crash-view-pack`
- Headless gates first: `bunx tsc --noEmit && bun test ./tests && bun run lint && bun run build:renderer`

## Scenarios

### S1 — Baseline (FR-002)

1. Launch with no enabled packs → single **Chat** item, expanded; no × on its header.

### S2 — Expand/collapse animation (FR-001/FR-004)

1. Enable `views-pack` → a **Results Explorer** item appears below Chat and auto-expands.
2. Click **Chat** header → Results Explorer's region animates closed while Chat's expands (smooth height, no snap, no layout jump).
3. Click back — same in reverse.

### S3 — Pack tab (FR-003)

1. `notes-pack` enabled → a **notes-pack** item exists (workspace browser + runs inside), expandable like any other item.

### S4 — State preservation (FR-007)

1. In Results Explorer mutate state; draft a chat message in Chat.
2. Switch Chat ↔ Results Explorer → extension state + chat draft intact (no reload).

### S5 — Lifecycle (019 parity)

1. × on an item's header → pack disabled → item closes; selection falls back to Chat if needed.
2. Re-enable → item returns auto-expanded.
3. Restart → enabled items restored, Chat stays expanded, no opening animation on first paint.

### S6 — Keyboard nav (FR-009)

1. Focus an item header → ↑/↓ (and ←/→) move across items; Enter/Space expands.

### S7 — Crash containment

1. Enable `crash-view-pack`, expand its item → contained crash + Reload inside the region + `●` on header → Reload clears the badge.

### S8 — Reduced motion (FR-005)

1. OS reduce-motion on → all transitions instant.

### S9 — Many items

1. Enable several packs → vertical stack scrolls; all headers reachable.

## Pass/fail evidence

- Headless: `tests/workspace-tabs.test.ts` still green (model unchanged); any new pure helpers get tests.
- Live: S1–S9 in the dev window; watch the dev console for `view.setVisible` park/restore traffic on collapse/expand.
