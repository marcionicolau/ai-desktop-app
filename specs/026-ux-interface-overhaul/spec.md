# Feature Specification: Interface Usability Overhaul

**Feature Branch**: `026-ux-interface-overhaul`

**Created**: 2026-11-13

**Status**: Draft

**Input**: User description: "Create a specification to significantly improve the application interface — all components, interactions, colors, fonts, sizes and icons need substantial improvement to make interaction and use easier; use community UX best practices and the most suitable shadcn components as the base."

## Clarifications

### Session 2026-11-13

- Q: Who decides the new visual direction and how is it chosen? → A: The plan presents 2–3 candidate directions (palette, font pairing, icon family) with rendered samples; the owner picks one before implementation starts.
- Q: What is the smallest window size the app must support? → A: 800 × 600; the sidebar collapses to its icon rail at compact widths.
- Q: How are the usability criteria measured without outside testers? → A: A scripted walkthrough — the owner runs the core tasks before and after with a timer and a pass/fail checklist; participant-based targets are replaced by checklist pass rates and task times.
- Q: What is the pass bar for the before/after walkthrough time? → A: No task is slower than its recorded baseline and every checklist item passes; a percentage improvement target is not required.
- Q: Can intermediate builds show a mixed old/new look? → A: Staged — the new palette and fonts apply app-wide first, then surfaces are reworked in slices that merge as they finish; only the release that closes this feature must have zero old-look leftovers.
- Q: Which panels become resizable, and how are the duplicated chat controls resolved? → A: The sidebar, the Metrics panel and the split panes of the workspace are resizable; the chat's mode, model (planner/executor) and persona choices each get exactly one control in the header. The scripts list/editor split is out of scope here because feature 027 replaces that page with a sidebar area.
- Q: Why were there two search boxes in the sidebar, and which stays? → A: The command palette trigger (`Ctrl/Cmd+K`) stays as the single search entry point; the separate sidebar chat-search input is removed. The palette keeps title filtering, message-content search and highlighted results (feature 007's behavior, now in the palette).
- Q: How far does screen-reader support go? → A: Markup-level — correct landmarks, headings, labels, roles and live-region announcements for status and errors, verified by automated accessibility tooling and a manual pass on one OS; real screen-reader sessions on every OS are out of scope.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Clear, consistent interaction feedback (Priority: P1)

As a user, every action I take — sending a message, loading a model, downloading a file, approving a tool call, importing a backup — gives me immediate, understandable feedback: what is happening, whether it worked, and what I can do next. Loading, empty, success and error states look and behave the same way on every screen.

**Why this priority**: Today status is communicated differently per feature (inline text, banners, silent changes). Inconsistent feedback is the largest source of "did that work?" friction and the foundation the other stories build on.

**Independent Test**: Trigger one success, one failure, one long-running and one empty state on at least six different surfaces → each uses the same feedback patterns, wording style and placement, and the user can always tell what to do next.

**Acceptance Scenarios**:

1. **Given** any action that takes longer than a moment, **When** it starts, **Then** the user sees a progress or busy indicator within 200 ms, and the triggering control cannot be double-activated.
2. **Given** an action completes or fails, **When** the result is known, **Then** a non-blocking confirmation or an error message with a recovery action appears in a consistent location.
3. **Given** a list or panel with no content, **When** it is shown, **Then** it displays an empty state that explains why it is empty and offers the primary next action.
4. **Given** a destructive action (delete conversation, remove model, clear data), **When** the user triggers it, **Then** a confirmation names the affected item and the consequence.

---

### User Story 2 - Readable, comfortable visual design (Priority: P1)

As a user, text is easy to read, controls are easy to hit, and the visual hierarchy tells me what matters on each screen. Colors, font sizes, spacing and icon sizes follow one defined scale; contrast meets accessibility guidelines in both light and dark themes.

**Why this priority**: The request names colors, fonts, sizes and icons explicitly. Legibility and hierarchy affect every second of use.

**Independent Test**: Audit every surface in light and dark themes → body text and controls meet WCAG AA contrast, the type and spacing scales are the only ones in use, interactive targets meet minimum size, and icons are from one family with consistent sizing and meaning.

**Acceptance Scenarios**:

1. **Given** any text or icon in either theme, **When** its contrast is measured against its background, **Then** it meets WCAG 2.2 AA (4.5:1 for body text, 3:1 for large text and UI glyphs).
2. **Given** any interactive control, **When** it is rendered at default settings, **Then** its hit area is at least 24×24 px and primary controls at least 32 px high.
3. **Given** the whole app, **When** font sizes, weights and spacings are inventoried, **Then** they come from a defined scale of a small number of steps, with no one-off values.
4. **Given** an icon that represents an action, **When** the same action appears elsewhere, **Then** it uses the same icon, size and label; icon-only controls have a tooltip and an accessible name.
5. **Given** the same screen in light and dark themes, **When** compared, **Then** hierarchy and emphasis (primary vs. secondary vs. destructive) read identically.

---

### User Story 3 - Efficient navigation and keyboard use (Priority: P2)

As a frequent user, I can reach any conversation, model, persona, setting or action quickly, with the keyboard if I prefer, and I always know where I am in the app.

**Why this priority**: Power users spend their time switching between chats, models and roles; the app has grown many surfaces and discoverability has not kept pace.

**Independent Test**: With only the keyboard, perform: open a conversation by name, start a new chat, switch the active model, open settings, and return to chat → each takes at most a few keystrokes and focus is always visible and logical.

**Acceptance Scenarios**:

1. **Given** the app is open, **When** the user invokes the command palette, **Then** they can search and run navigation and common actions by typing.
2. **Given** any screen, **When** the user tabs through it, **Then** focus order follows visual order, focus is always visibly indicated, and no keyboard trap exists.
3. **Given** a common action with a shortcut, **When** the user looks for it, **Then** the shortcut is shown next to the action and listed in one discoverable place.
4. **Given** the user is deep in a panel or dialog, **When** they look at the header, **Then** a title or breadcrumb tells them where they are.

---

### User Story 4 - Forms and settings that are hard to get wrong (Priority: P2)

As a user configuring models, roles, personas, tools, scripts and generation settings, each control matches its data (toggle for on/off, slider with value for ranges, choice list for options), explains itself, validates as I type, and shows what will happen before I commit.

**Why this priority**: The settings surfaces have grown by accretion; mismatched or unexplained controls cause misconfiguration.

**Independent Test**: Walk every settings and editor form → each field has a label and help text, shows validation inline, shows units and ranges, and a changed-but-unsaved state is visible.

**Acceptance Scenarios**:

1. **Given** a form field with constraints, **When** the user enters an invalid value, **Then** an inline message explains the constraint and how to fix it, without losing the entered value.
2. **Given** a numeric range setting, **When** the user adjusts it, **Then** the current value, unit and allowed range are visible and the control supports both dragging and exact entry.
3. **Given** a form with unsaved changes, **When** the user tries to leave, **Then** they are warned and can save or discard.
4. **Given** a long settings area, **When** it is shown, **Then** related fields are grouped under clear headings and the groups are navigable.

---

### User Story 5 - Comfortable at any window size and density (Priority: P3)

As a user, the app stays usable and uncluttered when the window is narrow or large, and I can choose a comfortable density.

**Why this priority**: A desktop app is routinely resized and shared across screen sizes; cramped or stretched layouts undermine all the above.

**Independent Test**: Resize from the minimum supported window up to a large display → no content is clipped or overlaps, line lengths stay readable, and panels reflow.

**Acceptance Scenarios**:

1. **Given** the window is at its minimum supported size (800 × 600), **When** any screen is shown, **Then** all primary actions remain reachable without horizontal scrolling of the page.
2. **Given** a very wide window, **When** chat is shown, **Then** message line length stays within a comfortable reading width.
3. **Given** the user prefers more compact or more spacious layouts, **When** they change density, **Then** spacing and control sizes adjust consistently across the app.

---

### User Story 6 - A focused, adjustable workspace (Priority: P2)

As a user chatting with a planner and an executor model, I choose the mode, the models and the persona in one place — not in three. I can also drag panels to the size I want, so the conversation gets the room instead of a fixed-height metrics block.

**Why this priority**: The current chat screen repeats the same choices in the header, in a second control bar and in a persona box, and at common window sizes the messages are left with a sliver of height. Both problems come from the same layout.

**Independent Test**: Open a fusion chat at 1024 × 720 → the mode, planner, executor and persona can each be changed from exactly one place; drag the Metrics panel's edge and the sidebar's edge → both resize, hold their size after a restart, and a reset returns the defaults.

**Acceptance Scenarios**:

1. **Given** a chat in fusion mode, **When** the header is shown, **Then** mode, planner, executor and persona each have exactly one control, and a change made there is the only place it needs to be made.
2. **Given** a chat in single mode, **When** the header is shown, **Then** it offers the one model choice and no planner or executor controls.
3. **Given** the planner and executor models together do not fit in memory, **When** the header is shown, **Then** a compact status says so, with the detail available on demand instead of as a separate row.
4. **Given** a control that cannot be changed right now (a reply is streaming, an unbound role), **When** the user looks at it, **Then** it is disabled with the reason, and any error appears next to the header, not as a second control bar.
5. **Given** the sidebar and the Metrics panel, **When** the user drags an edge or uses the keyboard on the resize handle, **Then** the panel resizes within sensible minimum and maximum sizes, and the Metrics panel can also be collapsed.
6. **Given** resized panels, **When** the app is restarted, **Then** the sizes are restored; **When** the user chooses Reset layout, **Then** the defaults return.
7. **Given** an extension view shown inside the workspace, **When** a panel is resized, **Then** the view follows the new bounds without being left misplaced.

---

### Edge Cases

- The user has the OS "reduce motion" or "increased contrast" preference enabled → animation is removed or minimized and contrast improves accordingly.
- Very long conversation titles, model file names or error messages → truncated or wrapped without breaking layout, with the full text available on demand.
- Many items (hundreds of conversations, models or tool results) → lists remain responsive and navigable by keyboard.
- Several feedback messages arrive at once → they stack or queue without hiding one another or the control the user is using.
- A screen is shown while a model is loading, generating or a background download runs → controls that are unavailable are visibly disabled with the reason stated.
- Extension-provided views appear inside the app shell → app chrome (titles, theme, focus) stays consistent; the extension's own content is out of scope.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every user-initiated action that takes noticeable time MUST show progress feedback within 200 ms and prevent accidental repeat activation.
- **FR-002**: Action outcomes MUST be reported through one consistent pattern — a non-blocking confirmation for success and an error message with a recovery action for failure — in one consistent location.
- **FR-003**: Every list, panel and result area MUST define loading, empty and error states using shared patterns; an empty state MUST state why it is empty and offer the primary next action.
- **FR-004**: Destructive actions MUST require confirmation that names the affected item and the consequence.
- **FR-005**: All text and meaningful graphics MUST meet WCAG 2.2 AA contrast in both light and dark themes.
- **FR-006**: The app MUST use a single defined scale for typography (families, sizes, weights, line heights), spacing, radii and icon sizes; one-off values are not permitted.
- **FR-007**: Interactive controls MUST meet minimum target sizes (24×24 px hit area; primary controls ≥ 32 px high) and show distinct hover, focus, active, disabled and busy states.
- **FR-008**: The app MUST use one icon family with one icon per concept, consistent sizing, and accessible names; icon-only controls MUST expose a tooltip.
- **FR-009**: Emphasis levels (primary, secondary, tertiary, destructive, warning, success, info) MUST be expressed through a single shared set of semantic color roles used identically across screens.
- **FR-010**: The app MUST provide a command palette for searching and running navigation and common actions, and MUST show the keyboard shortcut next to any action that has one.
- **FR-011**: Every screen MUST be fully operable by keyboard with a visible focus indicator, a logical focus order, and no keyboard traps; dialogs MUST trap focus while open and restore it on close.
- **FR-012**: Every screen MUST show the user's location through a title or breadcrumb.
- **FR-013**: Form controls MUST match their data type, show labels, help text, units and allowed ranges, validate inline without discarding input, and indicate unsaved changes; leaving with unsaved changes MUST warn.
- **FR-014**: Related settings MUST be grouped under clear headings with in-page navigation for long areas.
- **FR-015**: Layouts MUST remain usable from the minimum supported window size (800 × 600, where the sidebar collapses to its icon rail) to large displays: no clipped or overlapping content, no horizontal page scrolling, and chat line length capped to a comfortable reading width.
- **FR-016**: The user MUST be able to choose between at least two interface densities; the choice MUST persist and apply consistently.
- **FR-017**: The app MUST honor the OS reduced-motion and increased-contrast preferences.
- **FR-018**: Long text (titles, file names, errors) MUST truncate or wrap without breaking layout, with the full text available on demand.
- **FR-019**: Unavailable controls MUST be visibly disabled and state the reason (for example "a model is loading").
- **FR-020**: All new or reworked interface elements MUST be built from the project's standard shadcn component set and its theme tokens; no alternative component libraries are introduced, and existing behaviour, data and RPC contracts are unchanged.
- **FR-021**: The app MUST adopt a new, documented visual direction — color palette, font stack and icon family — that replaces the feature-021 identity, applied to every surface in both themes with no screen left on the old look in the release that closes this feature; work MAY merge in stages (app-wide palette and fonts first, then per-surface slices) before then. The direction MUST be chosen from 2–3 candidates, presented with rendered samples, and approved by the owner before implementation begins.
- **FR-022**: Every screen MUST expose correct landmarks, headings, labels and roles, and MUST announce status changes and errors (including streaming-reply completion) through live regions.
- **FR-023**: In the chat header, mode (single or fusion), model (or planner and executor) and persona MUST each have exactly one control; choosing one MUST NOT require touching a second control, and no second bar of selectors is shown.
- **FR-024**: The planner/executor memory-fit information MUST be shown as a compact status with detail on demand, not as a separate row of controls.
- **FR-025**: The sidebar, the Metrics panel and the workspace's other split panes MUST be resizable by pointer and by keyboard within minimum and maximum sizes that keep every control usable at 800 × 600; the Metrics panel MUST also be collapsible.
- **FR-026**: Panel sizes and collapsed states MUST be remembered per window and MUST be resettable to the defaults from the command palette and Settings.
- **FR-027**: Resizing a panel MUST keep any extension view in the workspace correctly positioned.

### Key Entities

- **Layout preferences**: the remembered size and collapsed state of each resizable panel, per window.
- **Design scale**: The single set of typography, spacing, radius, icon-size and color-role values every screen draws from, derived from the new visual direction (palette, font stack, icon family).
- **Feedback pattern**: The shared definition of progress, success, error, empty and confirmation states (content, placement, timing).
- **Interface preferences**: The user's persisted choices for theme and density, plus detected OS preferences (reduced motion, increased contrast).
- **Action registry**: The list of navigable destinations and common actions, with their shortcuts, that the command palette searches.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of surfaces pass an accessibility audit at WCAG 2.2 AA for contrast, focus visibility and keyboard operation, in both themes, using automated accessibility tooling plus a manual pass on one OS; screen-reader sessions on every OS are out of scope.
- **SC-002**: In a scripted walkthrough of the core tasks (start a chat, switch model, change a generation setting, import a file, delete a conversation), 100% of tasks pass the checklist on the first attempt without consulting documentation, and each task's time is no worse than the pre-change baseline recorded with the same script.
- **SC-003**: Median time to reach a named conversation, model or setting from any screen is under 5 seconds, and under 3 keystrokes of navigation once the command palette is open.
- **SC-004**: The same walkthrough, run before and after, shows no task slower than its recorded baseline and a 100% checklist pass rate.
- **SC-005**: An inventory of the app finds zero typography, spacing or icon values outside the defined scales, and one icon per concept.
- **SC-006**: Zero reports of clipped, overlapping or unreachable content across a defined window-size matrix (minimum to large), checked in both themes and both densities.
- **SC-007**: Every action that takes longer than 200 ms shows progress, and every failure shows a recovery action, verified across a checklist of all user-initiated actions.
- **SC-008**: All existing quality gates (typecheck, lint, tests, builds) pass and no existing behaviour regresses.
- **SC-009**: In a side-by-side review of every surface before and after, 100% of surfaces show the new visual direction with no leftover elements from the previous palette, fonts or icons.
- **SC-010**: At 800 × 600 with the Metrics panel open at its default size, the conversation area is at least 40% of the window height.
- **SC-011**: An inventory of the chat header finds each of mode, model (planner and executor) and persona selectable in exactly one place.

## Assumptions

- This work builds on feature 021 (shadcn component layer, light/dark tokens, sidebar shell, ai-elements); it refines and extends that foundation rather than replacing the component boundary rules.
- Scope is the app's own interface (chat, models, roles, personas, scripts, settings, extensions management, updates, setup); content rendered by third-party extension views is out of scope.
- The app targets desktop windows only; touch and mobile layouts are out of scope.
- Behaviour, data formats and RPC contracts are unchanged; only presentation and interaction change.
- The interface language stays as is; localization is out of scope.
- Usability is verified by a scripted walkthrough run by the owner before and after the change (timed, with a pass/fail checklist), plus standard accessibility tooling; no outside participant panel is required.
- The visual identity is redesigned: a new color palette, font stack and icon family replace feature 021's, while 021's component-boundary rules (single component layer, no direct low-level primitives in feature code) and light/dark theme support are kept. Planning presents 2–3 candidate directions with rendered samples; the owner picks one before implementation, and it becomes the source of the design scale.
- The command palette (User Story 3, FR-010) is in scope as a new global surface, searching navigation destinations and common actions.
