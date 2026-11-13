# Contract: Design Tokens

Source of truth: `src/renderer/src/index.css` (`:root`, `.dark`, `[data-density]`, media-query blocks) and the `@theme inline` map.

## Required token names (stable across candidates)

- Color roles: `--background --foreground --card --popover --muted --muted-foreground --border --input --ring --primary --secondary --accent --destructive --success --warning --info` (each with `-foreground` where applicable).
- Type: `--font-ui --font-reading --font-mono`; sizes `--text-xs … --text-2xl` (6 steps); weights 400/500/600.
- Spacing/density: `--space-unit` (4 px × density factor), `--control-h-sm|md|lg`, `--row-pad`.
- Icon sizes: `--icon-sm|md|lg` (14/16/20).
- Motion: `--motion-fast|base` (0 under reduced motion).

## Rules (enforced by `tests/ui-audit.test.ts`)

1. No arbitrary pixel font sizes or `size-*` icon sizes outside the named set.
2. No palette literals outside `components/ui/` and `index.css` (existing rule).
3. Every foreground/background pair listed in `tests/ui-contrast.test.ts` meets WCAG 2.2 AA in light, dark, and `prefers-contrast: more`.
4. `[data-density="compact"]` and `"comfortable"` define every spacing token.
