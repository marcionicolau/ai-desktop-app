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
