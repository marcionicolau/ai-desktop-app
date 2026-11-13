# Research: Interface Usability Overhaul

## R1 — Visual direction candidates (Gate G0)

**Decision**: Present three candidates with rendered samples; owner chooses (clarification 1). Candidates are proposals, not final values; each defines palette (light + dark, OKLCH), type pairing, icon family.

| | A · Graphite | B · Paper | C · Midnight |
|---|---|---|---|
| Neutrals | zinc | warm stone | blue-slate |
| Accent | teal | amber | violet |
| UI font / mono | Inter Variable / Geist Mono | Source Sans 3 / JetBrains Mono | DM Sans / Fira Code |
| Reading font (assistant text) | Inter | Source Serif 4 | DM Sans |
| Icons | Phosphor (regular) | Tabler | Remix |
| Character | neutral, tool-like | warm, document-like | dark-first, high energy |

**Rationale**: spans three genuinely different moods; each maps to a shadcn-supported icon library, and all have Fontsource variable packages (existing pattern).
**Alternatives**: single proposal (rejected by clarification 1); keeping lucide (rejected — FR-021 replaces the icon family, though lucide stays an allowed candidate if the owner prefers).

## R2 — Enforcing the design scale

**Decision**: Extend `tests/ui-audit.test.ts` with rules: no arbitrary `text-[..px]`; no `size-3|3.5` outside an allow-list during staging, then none; icons imported only via `components/icons.ts`; no native `<select>`, checkbox or range outside `ui/`. Each rule runs as `console.warn` summaries until its last violation is converted, then becomes a failure at once (overlays in T033, native controls in T048); the rest flip in the final polish task.
**Rationale**: the repo already enforces boundaries this way (021), so no new tooling.
**Alternatives**: custom oxlint rules (rejected: plugin infra); Stylelint (rejected: new dep).

## R3 — New dependencies

**Decision**: add `sonner` (toast) and `cmdk` (command palette) through shadcn's `sonner`/`command` components; new Radix packages (dialog, select, switch, slider, tabs, popover, checkbox, label) come in via shadcn and are imported only inside `components/ui/`.
**Rationale**: both are the libraries shadcn's own components wrap; re-implementing them is more code and worse accessibility.
**Alternatives**: custom toast/palette (rejected, above).

## R4 — Accessibility verification without new test frameworks

**Decision**: (a) `tests/ui-contrast.test.ts` converts OKLCH token pairs to sRGB and asserts WCAG ratios in both themes; (b) enable oxlint's built-in `jsx-a11y` rules for static checks (labels, aria on icon-only buttons); (c) manual axe-core pass via the browser extension on the Vite dev server for both themes; (d) manual pass on one OS with a screen reader (clarification 5).
**Rationale**: zero new dependencies; covers SC-001 as scoped.
**Alternatives**: axe-core + jsdom in `bun test` (rejected: new dev deps, jsdom gaps); Playwright (rejected: heavy).

## R5 — Density

**Decision**: `data-density="comfortable|compact"` on `<html>`; spacing, control height and row padding derive from CSS variables set per density; `lib/density.ts` mirrors `lib/theme.ts`; persisted as `Settings.density` via `settings.set`.
**Rationale**: same mechanism as theme; no component-level branching.
**Alternatives**: per-component props (rejected: scattered, hard to audit).

## R6 — Motion and contrast preferences

**Decision**: CSS only — `@media (prefers-reduced-motion: reduce)` zeroes transition/animation durations via a token; `@media (prefers-contrast: more)` swaps to a higher-contrast token set; `forced-colors` honored by using system colors for borders/focus.
**Rationale**: no JS, testable by audit.

## R7 — Minimum window size (800 × 600)

**Decision**: layouts verified at 800 × 600 via a resize matrix; the sidebar uses its existing icon-rail collapse below a width breakpoint. **Verified (T007, 2026-11-13):** Electrobun's `BrowserWindow` options expose only `frame: {x, y, width, height}` (`.hutch/devkit/api/sdks/main/core/BrowserWindow.ts`); there is no minimum-size option. 800 × 600 is therefore a tested design floor, not an enforced limit, and layouts must degrade without breaking below it (T056 records this).
**Alternatives**: a native minimum via a custom FFI window call (rejected: outside the typed host API and platform-specific).

## R8 — Command palette scope

**Decision**: `Ctrl/Cmd+K` opens a shadcn Command dialog; groups: Conversations (search via existing `search.query`/title filter), Navigate (surfaces), Actions (new chat, switch model, toggle theme/density, open settings). Shortcuts appear in the palette rows via `Kbd`. Actions come from one registry (`lib/actions.ts`).
**Rationale**: reuses existing RPC; no new main-process API.

## R9 — Baseline walkthrough

**Decision**: S0 records the five core tasks (start chat, switch model, change a generation setting, import a file, delete a conversation) with timings and pass/fail on current `main` in `validation.md`; S6 repeats with the same script (SC-002, SC-004).
**Rationale**: SC-004 is defined against a recorded baseline, so it must be captured before any change.
