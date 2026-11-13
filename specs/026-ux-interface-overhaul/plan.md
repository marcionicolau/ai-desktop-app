# Implementation Plan: Interface Usability Overhaul

**Branch**: `026-ux-interface-overhaul` | **Date**: 2026-11-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/026-ux-interface-overhaul/spec.md`

## Summary

Replace feature 021's visual identity with a new, owner-approved direction and
raise interaction quality across all app surfaces: shared feedback patterns
(toasts, empty/loading/error states, confirmations, live regions), an enforced
design scale (type, spacing, icon sizes, semantic color roles), a command
palette with visible shortcuts, form controls matched to their data, responsive
layout down to 800 × 600, a persisted density setting, and reduced-motion /
increased-contrast support. Work is renderer-only: the shadcn component layer
under `components/ui/` is extended, tokens in `index.css` are replaced, and
`tests/ui-audit.test.ts` grows rules that make the scales enforceable. The only
main-process change is one new persisted setting (`density`) through the
existing typed `settings.set`.

Delivery is staged (clarification 4): a baseline walkthrough is recorded first,
then candidates are presented for owner approval (Gate G0), then app-wide tokens
land, then per-surface slices merge as they finish.

## Technical Context

**Language/Version**: TypeScript (strict), React 19, Bun runtime for tests

**Primary Dependencies**: Tailwind CSS v4 (CSS-first `@theme`), shadcn/ui (new-york style, vendored in `src/renderer/src/components/ui/`), lucide-react today (icon family is a Gate G0 decision), Fontsource variable fonts. New: `sonner` (toast), `cmdk` (command palette) — both shadcn's own wrapped dependencies; extra Radix primitives only inside `components/ui/`.

**Storage**: `settings.json` — one new optional field `density: "comfortable" | "compact"` (absent ⇒ comfortable). No other persistence.

**Testing**: `bun test ./tests` — extended `ui-audit.test.ts`, new token-contrast test (pure TS, WCAG formula over OKLCH tokens), existing renderer tests; manual axe pass in the Vite dev server; scripted before/after walkthrough (recorded in `validation.md`).

**Target Platform**: Electrobun desktop (linux-x64 verified; mac/win configured), webview rendering the Vite-built renderer

**Project Type**: desktop-app (renderer-only change plus one setting)

**Performance Goals**: feedback visible ≤ 200 ms after an action; command palette opens ≤ 100 ms and filters ≤ 100 ms for the full action list; no new layout shift on theme/density switch

**Constraints**: 800 × 600 minimum (sidebar collapses to icon rail); WCAG 2.2 AA both themes; no RPC contract changes besides `settings.set` density; no direct `@radix-ui/*` imports outside `components/ui/` (existing rule)

**Scale/Scope**: ~60 renderer `.tsx` files, 11 feature folders, 17 vendored `ui/` primitives; hundreds of conversations in lists

### Baseline measured on `main` (inputs to the work)

| Signal | Count | Target |
|---|---|---|
| Arbitrary font sizes (`text-[10px]`, `text-[11px]`) | 29 uses | 0 |
| Files with native `<select>` | 9 | 0 (shadcn Select) |
| Files with native checkbox/range inputs | 4 | 0 (Switch/Checkbox/Slider) |
| Hand-rolled overlays (`fixed inset`) | 2 | 0 (Dialog/AlertDialog/Sheet) |
| Toast / transient feedback system | none | one (Sonner) |
| Files importing `lucide-react` directly | 26 | 1 (`components/icons.ts`) |
| Icon sizes in use | `size-3`, `size-3.5`, `size-4`, `w/h-3.5` mix | 3 named sizes |

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| I. Local-first inference | No inference or network change. PASS |
| II. Process boundaries | Density persists via the existing typed `settings.get/set` contract; renderer calls no native API outside it. PASS |
| III. Strict TypeScript | New types (`Density`, `ActionEntry`, `Notice`) are strict; `Settings.density` added to `shared/types.ts`. PASS |
| IV. Component standardization | All new UI from shadcn components + Tailwind v4 tokens; no alternative component library. PASS |
| V. Vite pipeline | No build changes; `vite build` and HMR stay green. PASS |
| VI. Minimal dependencies | Adds `sonner` and `cmdk` (justified in research R3); no a11y/test framework added; icon-family swap replaces, not adds. PASS with justification (see Complexity Tracking) |

Post-design re-check (after Phase 1): unchanged — PASS.

## Project Structure

### Documentation (this feature)

```text
specs/026-ux-interface-overhaul/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── design-tokens.md
│   ├── feedback.md
│   ├── actions.md
│   └── settings-density.md
├── candidates/          # Gate G0 rendered samples (created by tasks)
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/shared/types.ts                      # Settings.density
src/bun/store/json-store.ts              # density default/validation in settings.set path
src/bun/rpc/handlers.ts                  # settings.set accepts density
src/renderer/src/
├── index.css                            # tokens: palette, type, spacing, radii, density, motion/contrast
├── typeset.css                          # aligned to new type scale
├── components/
│   ├── icons.ts                         # one icon per concept; the only lucide/tabler import site
│   ├── ui/                              # + dialog, select, switch, slider, tabs, command, sonner,
│   │                                    #   field, label, checkbox, popover, empty, spinner, alert
│   └── ai/                              # re-skinned; behavior unchanged
├── lib/
│   ├── notify.ts                        # feedback API over Sonner
│   ├── actions.ts                       # action registry + shortcut table
│   └── density.ts                       # applies data-density, mirrors theme.ts
└── features/
    ├── command/CommandPalette.tsx       # new
    ├── (all existing feature folders)   # converted slice by slice
tests/
├── ui-audit.test.ts                     # + scale/icon/native-control rules
├── ui-contrast.test.ts                  # new: token contrast gate
└── renderer/                            # + palette filter, notify, density tests
```

**Structure Decision**: renderer-only layout above; no new top-level directories. `components/icons.ts` and `lib/notify.ts` are single choke points so enforcement is a grep-style audit rule rather than convention.

## Delivery Slices

| Slice | Scope | Spec refs | Mergeable alone |
|---|---|---|---|
| S0 | Record baseline walkthrough (timed, checklist) on current `main`; build 3 candidate samples; **Gate G0: owner picks one** | FR-021, SC-002/004 | yes (docs only) |
| S1 | App-wide tokens, fonts, icon map, type/spacing/icon scales; contrast test; audit rules (start as warnings for unconverted files) | FR-005–009, 021 | yes |
| S2 | Feedback layer: Sonner, Empty, Spinner, confirm dialogs, live regions, busy states, disabled-with-reason | FR-001–004, 019, 022 | yes |
| S3 | Shell: command palette, shortcuts, breadcrumbs/titles, focus order | FR-010–012 | yes |
| S4 | Forms/settings: Field, Select, Switch, Slider, unsaved-changes guard, grouping | FR-013, 014 | yes |
| S5 | Responsive 800 × 600, reading width, density setting, reduced motion/contrast, long-text handling | FR-015–018 | yes |
| S6 | Flip remaining audit rules to errors (overlay and native-control rules flip earlier, as their last violations are converted), re-run walkthrough, axe pass, write `validation.md` | all SCs | closes feature |

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| `sonner` dependency | shadcn's toast component wraps it; needed for non-blocking feedback (FR-002) | A hand-built toast stack would reimplement stacking, timers, a11y live regions and swipe-dismiss |
| `cmdk` dependency | shadcn's Command wraps it; needed for the palette (FR-010) | Hand-rolled fuzzy list loses keyboard/aria-combobox correctness |
