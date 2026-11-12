# Validation notes — 021-ai-ui-modernize

## T009 literal inventory (pre-migration, audit baseline)

19 files with palette literals flagged by `tests/ui-audit.test.ts`
(most are rewritten by US2 rebuilds; remainder migrated in T026):

- components/ai/ai-message.tsx
- components/ai/code-block.tsx
- features/chat/ChatPage.tsx, Composer.tsx, MessageList.tsx, Sidebar.tsx, ToolCallCard.tsx
- features/extensions/ExtViewHost.tsx, ExtensionsPanel.tsx, RunView.tsx, WorkspaceBrowser.tsx
- features/metrics/OutputPanel.tsx
- features/models/ModelLibrary.tsx
- features/personas/PersonasPanel.tsx
- features/roles/FusionControls.tsx, RolesPanel.tsx
- features/settings/GenerationSettings.tsx, ToolSettings.tsx
- features/workspace/WorkspaceAccordion.tsx

## Scope adjustments during implementation

- `react-sheet`/`react-popover` not installed: sidebar stays icon-rail
  (no offcanvas on desktop); suggestions render as chips, not popovers.
- Theme: `settings.set` gained a transient `resolvedTheme` param (validated,
  not persisted) — renderer reports the resolved scheme, main pushes it to
  extension views via existing `pushTheme`. No new RPC.
- Fonts: fontsource-bundled Public Sans/Geist/JetBrains Mono variable fonts
  (user-provided) — bundled assets, offline-safe; replaces the spec's
  assumed system stack (A3 updated in spirit).

## Gate results (implementation)

- `tsc --noEmit`: PASS
- `bun test ./tests`: PASS — 395 tests, 0 fail
- `bun run lint`: 0 errors (pre-existing warnings only)
- `bun run build:renderer`: PASS (pre-existing chunk-size warning)
- `tests/ui-audit.test.ts`: 3/3 PASS — zero radix imports outside ui/,
  zero palette literals outside ui/, ai/ dep rules hold

## T035 status — live validation recorded

Screenshots: `screenshots/light-system.png`, `screenshots/dark.png`,
`screenshots/light.png` (theme cycler walked System → Dark → Light in
the running dev app).

- S1 — PASS: `bun test ./tests/ui-audit.test.ts` 3/3 (zero radix imports
  outside ui/, zero palette literals, ai/ dep rules hold — incl. the
  post-convergence `checkpoint.tsx` + VariantNav/BranchOverview rebuild).
- S2 — visually verified: structured turn layout renders in the readable
  transcript column; composer + attachment affordance anchored bottom;
  header persona select, fusion model menus, metrics toggle all themed
  (native selects readable in dark via `color-scheme` fix, `985fe0f`).
- S3 — PASS (visible): System/Light/Dark all render correctly across
  sidebar, header, transcript, composer; override persists in the footer
  control. Extension live theme-sync (`pushTheme`) previously exercised
  during the sidebar work; reduced-motion + narrow-window not
  individually re-exercised this pass.
- S4 — verified: Chats group (New chat, Import…, search field,
  conversations), Extensions group (ext views + pack browsers +
  Manage…), Configurations group (Models/Personas/Roles/Settings),
  theme cycler footer; transcript capped at readable width with the
  composer anchored. Collapse→icon-rail + panel focus previously
  exercised during the panel-model work (incl. the TooltipProvider fix
  at `fdb8f68`).

Gate results unchanged: tsc clean, 395/395 tests, lint warnings
pre-existing, renderer build PASS.
