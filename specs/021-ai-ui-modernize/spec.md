# Feature Specification: Unified Component Layer & UX Refresh

**Feature Branch**: `021-ai-ui-modernize`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "Create a specification to swap all UI components that use Radix UI directly for shadcn, emphasize shadcn ai-elements for AI interfaces, do a complete update aiming to improve user experience (colors, fonts, font sizes, css media, etc). See how to integrate RadixUI with Shadcn at ui.shadcn.com/docs/ai-elements/radix/chain-of-thought"

## Clarifications

### Session 2026-11-12

- Resolved interpretation: the referenced ai-elements documentation shows these components are **recipes composed from the standard component library** (e.g., chain-of-thought = Trace + collapsible + Badge + Code Block), where the primitive layer stays underneath the wrappers. "Replace Radix with shadcn" therefore means **feature code never imports low-level primitive libraries directly — everything goes through the project's standardized component wrappers** — not that primitives are removed.
- Q: Does the visual refresh include a light theme or stay dark-only? → A: **System-following light + dark** — two full token sets driven by the OS preference (prefers-color-scheme), with a persisted manual override; extension view theme sync pushes the active palette.
- Added scope: main UI organization adopts the standardized sidebar-block pattern — **variant sidebar-05** (collapsible submenu nav groups + search form, provider + inset + trigger + context header) — with icon-rail collapse, keyboard shortcut, grouped navigation, and chat-app layout conventions (readable content width, anchored composer).
- Reference: the full ai-elements catalog (21 patterns) was enumerated; the adopted subset maps to existing surfaces as follows — Chat/Message Scroller (transcript), Message (turns), Prompt Input (composer), Plan/Chain of Thought (fusion planner phases), Tool + Stack Trace (tool calls + failures), Confirmation (tool ask-mode approvals), Suggestion (snippets/personas one-click prompts), Model Selector (model + fusion planner/executor tag picking), Checkpoint (conversation variant return points), Context (token budget usage), Task/Queue (pack pipeline run steps), Subagent (a pack run as a unit), File Tree (pack workspace files), Reasoning (streaming thinking), Code Block (standardized code). Deferred — no backing surface today: Sources, Inline Citation, Terminal, Test Results.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A single, enforced component layer (Priority: P1)

As a maintainer, every interactive surface in the app is built from the project's standardized component wrappers — never from low-level primitive imports or ad-hoc one-off styling — so the UI is consistent, discoverable, and one theme change propagates everywhere.

**Why this priority**: This is the foundation — a divergent component landscape is why colors/typography currently can't be updated in one place, and it's the explicit first half of the request.

**Independent Test**: audit the renderer — zero direct low-level primitive imports in feature code; every primitive used has a corresponding standardized wrapper; interactive surfaces render uniformly.

**Acceptance Scenarios**:

1. **Given** the renderer codebase, **When** it is audited for direct low-level primitive imports in feature code, **Then** none exist — all such usage flows through the project's component wrappers.
2. **Given** a primitive needed by a feature that has no standardized wrapper, **When** the feature is built, **Then** a project-convention wrapper is added to the shared component directory rather than the primitive being imported in place.

---

### User Story 2 - AI surfaces get purpose-built components (Priority: P1)

As a user chatting with models, the conversational surfaces — messages, the prompt input, multi-step agent activity (fusion planning phases, tool calls), and code — are rendered by purpose-built AI components, so streaming responses read clearly, agent work is transparent and collapsible, and composing prompts feels like a modern AI tool.

**Why this priority**: The ai-elements emphasis is the second explicit half of the request and the largest visible UX gain — fusion plan phases and tool calls currently render as plain text blocks.

**Independent Test**: run a fusion turn and a tool-calling turn → agent steps appear as an expandable step trace (running → done/failed states); send/receive messages → structured message layout; compose a prompt with attachments/snippets → all existing capabilities preserved.

**Acceptance Scenarios**:

1. **Given** a fusion turn executes, **When** the planner produces a plan, **Then** the plan renders inside a collapsible step-trace element (distinct from the answer) that the user can expand/collapse.
2. **Given** a tool-calling turn executes, **When** tool invocations and results stream, **Then** they render as structured steps showing tool name and running/complete/failed status — not raw text blocks.
3. **Given** the chat transcript, **When** messages render, **Then** they use a structured message component (role-aware layout, actions, markdown/code presentation preserved).
4. **Given** the prompt input, **When** the user composes with attachments, snippets, and model state, **Then** the input is a purpose-built AI prompt component and no existing capability is lost.

---

### User Story 3 - The app looks and reads better (Priority: P2)

As a user, the whole interface gets a coherent visual refresh — a refined color palette, a defined typography scale (font stack, sizes, weights, line heights), consistent spacing/density — so the app feels polished and text is comfortable to read for long sessions.

**Why this priority**: The "complete update for UX" portion. P2 because it's polish layered on the standardized layer from US1 — it only becomes cheap to do well once theming flows through one component layer.

**Independent Test**: visual review of every surface (chat, workspace, panels, settings, dialogs, extension chrome) → consistent palette and type scale; text legibility at all sizes; no surface left on ad-hoc styling.

**Acceptance Scenarios**:

1. **Given** any screen in the app, **When** colors are inspected, **Then** they resolve to a shared, named palette token — no hardcoded color values in feature code.
2. **Given** text across surfaces, **When** it is compared, **Then** sizes and weights follow a defined, limited type scale rather than ad-hoc values.
3. **Given** a user with reduced-motion enabled, **When** they use the app, **Then** all non-essential motion is disabled.
4. **Given** the OS is in light mode (or the user toggles light), **When** the app renders, **Then** every surface — including extension view chrome — presents the light palette without manual restarts.
5. **Given** a user who toggles the theme manually, **When** they restart the app, **Then** their choice is remembered and takes precedence over the OS preference.

---

### User Story 4 - Standard navigation shell (Priority: P2)

As a user, the app is organized around a proper navigation sidebar — collapsible, grouped, keyboard-accessible — holding conversations and the extensions entry point, with a slim context header, while the workspace (chat and extension surfaces) fills the main area following standard chat-app conventions: readable content width, anchored composer, scroll-anchored transcript.

**Why this priority**: The current sidebar is a fixed hand-rolled panel with an ungrouped list; adopting the standard sidebar-block organization gives collapse-to-icons, keyboard toggle, grouped navigation, and a consistent shell for both chat and extension surfaces.

**Independent Test**: collapse the sidebar → icon rail, workspace expands; keyboard shortcut toggles it; conversations grouped under navigation; extensions reachable from the sidebar; chat content stays readable at wide window sizes.

**Acceptance Scenarios**:

1. **Given** the app is open, **When** the user toggles the sidebar (button or keyboard shortcut), **Then** it collapses to an icon rail and the workspace expands to fill the freed space — and toggles back without losing state.
2. **Given** the sidebar, **When** the user navigates, **Then** conversations are listed in a grouped, searchable nav with clear active-state indication, and the extensions section/entry is a first-class nav item.
3. **Given** a wide window, **When** the chat surface is visible, **Then** message content stays within a readable line length (centered column) while the composer remains anchored at the bottom.
4. **Given** a narrow window, **When** the sidebar is open, **Then** it overlays or compresses rather than breaking the workspace layout (per the sidebar component's responsive behavior).

---

### Edge Cases

- **Extension-hosted views**: pack-authored content inside extension views must not be restyled beyond shared theme tokens — pack authors own their internals.
- **Streaming during refresh**: new message/agent components must handle partial/streamed content gracefully (incomplete markdown, running steps).
- **Capabilities preserved**: the refreshed prompt input must retain attachments, slash-snippet picker, and stop/send states; the message surface must retain regenerate/edit/variant navigation actions.
- **Long transcripts**: refreshed message rendering must not regress scroll performance on long conversations.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Feature code MUST NOT import low-level UI primitive libraries directly; all primitive usage MUST flow through the project's standardized component wrappers.
- **FR-002**: An audit MUST catalog every current ad-hoc/primitive usage and either migrate it to an existing wrapper or add a missing wrapper following project conventions.
- **FR-003**: Conversational surfaces MUST use purpose-built AI components per the adopted element map: a scroll-anchored transcript, structured turn messages, a purpose-built prompt input, collapsible step traces (fusion plan phases, tool calls), approval prompts for gated tool use, one-click prompt suggestions, model/role selection, conversation return points, context-usage indication, run-step views, pack workspace file trees, and standardized code presentation.
- **FR-004**: Agent activity MUST render as collapsible step traces showing per-step status (running, complete, failed): fusion planning phases, tool invocations (with failure detail), and pack pipeline run steps.
- **FR-005**: The prompt input MUST retain all existing capabilities — text compose, attachments, slash-snippet insertion, send/stop states, model-load shortcut.
- **FR-006**: Message rendering MUST retain all existing capabilities — markdown, code blocks, regenerate/edit actions, variant navigation, attachment chips.
- **FR-007**: A shared theme token set MUST define light and dark palettes, radii, spacing, and a bounded typography scale (font stacks, sizes, weights, line heights); feature code MUST reference tokens, not raw values.
- **FR-008**: The active theme tokens MUST propagate to extension view surfaces through the existing theme-sync mechanism, following live theme changes without restart.
- **FR-009**: Theme selection MUST follow the OS color-scheme preference by default; a manual light/dark/system override MUST be available and persisted across restarts.
- **FR-011**: Media-query behavior MUST be respected app-wide: non-essential animation disabled under reduced-motion, and the layout must remain usable in narrow window sizes.
- **FR-012**: The app shell MUST use the standardized sidebar component system: provider + collapsible sidebar + inset content area + trigger; collapse MUST support an icon-rail mode and a keyboard shortcut.
- **FR-013**: Sidebar navigation MUST follow the collapsible-submenu-group pattern (sidebar-05): a top-level search field, collapsible nav groups (conversations, extensions, settings/tools) with active-state styling, and all existing capabilities retained — conversation select/new/rename/delete, search filtering, import/export.
- **FR-014**: The workspace MUST follow chat-app layout conventions: readable maximum content width for the transcript at wide windows, composer anchored to the bottom of its surface, and a slim context header consistent across the app.
- **FR-015**: Collapsing/expanding the sidebar MUST NOT disturb the workspace accordion state or running extension sessions.
- **FR-010**: All existing behaviors MUST be preserved — workspace accordion, extension lifecycle, drawer/panel views, run views, settings/model/persona panels — with no functional regression.

### Key Entities

- **Component Inventory**: catalog of interactive surfaces, which standardized wrapper each uses, and gaps needing new wrappers.
- **Theme Tokens**: named palettes (light + dark), spacing, radius, and typography definitions consumed app-wide (including extension view sync); plus a persisted theme-mode preference (`system | light | dark`).
- **AI Surface Map**: the adopted element set (from the 21-pattern ai-elements catalog) mapped to existing surfaces — transcript, turns, prompt input, plan/tool/run step traces, approvals, suggestions, model/role selection, checkpoints, context usage, file trees, code — with four deferred patterns (Sources, Inline Citation, Terminal, Test Results) adopted only if a real surface emerges.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Audit passes with zero direct low-level primitive imports in feature code and zero hardcoded color/size values outside the token set.
- **SC-002**: Agent activity (fusion plans, tool calls) is rendered as structured, collapsible steps in 100% of applicable turns.
- **SC-003**: 100% of the existing automated test suite passes unchanged (no functional regressions).
- **SC-004**: Body text meets WCAG AA contrast on all refreshed surfaces; a defined type scale of ≤8 steps covers the whole app.
- **SC-005**: With reduced-motion enabled, zero non-essential animations play; in the narrowest supported window, all controls remain reachable.
- **SC-006**: Users can complete the core loop — compose, send, read a response, inspect agent steps — with no more interactions than before.

## Assumptions

- **A1**: The low-level primitive layer remains inside the component wrappers (per the referenced ai-elements integration model); the requirement is eliminating *direct* imports from feature code.
- **A2**: Purpose-built AI components are adopted as project-convention wrappers composed from the shared component library (the ai-elements recipe model), not as a new external component framework.
- **A3**: Typography uses an offline-safe font stack (system UI + monospace for code); no webfont downloads, consistent with local-first operation.
- **A4**: Refreshed theme tokens propagate to extension views through the existing theme-sync mechanism introduced with extension views.
- **A5**: Extension pack-authored view internals are excluded from restyling beyond shared tokens.
- **A6**: The refresh includes a modest media-query pass (reduced motion, narrow-viewport resilience) — not a full responsive redesign for mobile form factors.
- **A7**: AI elements with no backing surface in the app today (Sources, Inline Citation, Terminal, Test Results) are explicitly out of scope; they're adopted only when a real surface emerges.
