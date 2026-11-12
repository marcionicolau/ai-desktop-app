# Feature Specification: Workspace Tabs — Accordion UX

**Feature Branch**: `020-tabs-accordion-ux`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "change WorkspaceTabs.tsx to use https://www.radix-ui.com/primitives/docs/components/accordion#animating-content-size, update the component names, enable animation and other UX improvements"

## Clarifications

### Session 2026-11-12

- Q: Which surface does the accordion primitive shape? → A: **Vertical accordion workspace** — Chat + each pack is a stacked expandable item; selecting a header expands its content inline with animated content size. The horizontal tab strip is replaced by the vertical item stack. Exactly one item is expanded at a time (tab semantics: selecting an item expands it and collapses the previously expanded one).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Workspace surfaces animate instead of snapping (Priority: P1)

As a user, my workspace is a vertical stack of expandable items — Chat first, then one item per extension surface — and selecting an item's header expands its content inline with a smooth animated size transition, so moving between surfaces feels polished and I keep visual context of what changed.

**Why this priority**: This is the entire ask — the tab system exists (feature 019); this feature replaces the horizontal strip with a vertical accordion whose content regions animate open/closed.

**Independent Test**: With views-pack enabled, expand Chat → Results Explorer → notes-pack in turn → each content region animates open/closed smoothly; no reload flicker, no layout jump.

**Acceptance Scenarios**:

1. **Given** two or more workspace items, **When** the user selects a different item's header, **Then** its content region expands with a smooth animated-size transition while the previously expanded region collapses.
2. **Given** an expanded extension surface, **When** the user returns to Chat, **Then** the transition animates and the chat contents (draft, scroll position) are unchanged.
3. **Given** the workspace after restart, **When** it first renders, **Then** the expanded surface is visible without a visible open animation on first paint (no startup flicker).

---

### User Story 2 - Workspace components are named for their role (Priority: P2)

As a maintainer, the workspace tab components have names that describe what they render (accordion structure, trigger row, content panes), so the module is discoverable and consistent with the project's component conventions.

**Why this priority**: Maintainability only — no user-visible change. P2 because it's part of the request but can't ship user value alone.

**Independent Test**: code review — component/file names in the workspace module match their rendered role and follow the project's component naming conventions.

**Acceptance Scenarios**:

1. **Given** the workspace module, **When** a developer reads its exports, **Then** each component's name identifies its role (e.g., workspace accordion, item trigger, content pane) without opening the file.

---

### User Story 3 - Tab interactions keep their polish and gain affordances (Priority: P2)

As a user, everything the tab strip already does (pack tooltips, crash indicator, close-to-disable, usable with many items) keeps working on the accordion headers, and I can additionally move across workspace items with the keyboard.

**Why this priority**: The animation upgrade must not regress feature 019 behaviors; keyboard affordance is the standard UX improvement that comes with the primitive.

**Independent Test**: disable/re-enable a pack mid-session → its workspace item closes/opens accordingly; hover a trigger → pack tooltip; crash a view → indicator shows; keyboard arrows move selection across items.

**Acceptance Scenarios**:

1. **Given** several workspace items, **When** the user presses arrow keys with focus on the trigger row, **Then** selection moves predictably between Chat and pack items.
2. **Given** an enabled pack's workspace item, **When** the user clicks its close affordance, **Then** the owning pack is disabled and the item closes (unchanged semantics).
3. **Given** a crashed extension view, **When** its workspace item is visible, **Then** the crash indicator still renders on its trigger.

---

### Edge Cases

- **Reduced motion**: users with reduced-motion OS settings get instant transitions (no animation).
- **Rapid switching**: selecting items faster than the animation duration must not queue weirdness or lose state — the latest selection wins cleanly.
- **Single item**: with only Chat present, no animation affordances are needed but nothing breaks.
- **Content height variance**: pack surfaces with very different content heights animate to their natural size without clipping or scrollbars appearing mid-animation unnecessarily.
- **Many items**: a long vertical stack scrolls; item headers remain reachable (no horizontal overflow issue).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Workspace surfaces (Chat + pack tabs from feature 019) MUST present as a vertical stack of expandable items; exactly one item's content is expanded at a time and selection changes animate the content region's size — no instant show/hide swap.
- **FR-002**: Chat MUST remain the first workspace item and MUST NOT be closable.
- **FR-003**: Every enabled pack MUST keep its workspace presence: one item per declared `tab` view, plus a `pack` workspace item for packs without `tab` views (parity with feature 019 FR-012).
- **FR-004**: The expansion animation MUST adapt to each content region's natural size (animated content size, not a fixed-height tween) and MUST NOT cause layout jumps in surrounding chrome.
- **FR-005**: Animations MUST be disabled when the user's OS requests reduced motion.
- **FR-006**: Selecting items faster than the animation completes MUST end on the latest selection with state intact — no queued replays.
- **FR-007**: Hidden surfaces' running state MUST be preserved across switches — chat draft/scroll and extension view sessions must not be torn down on hide (parity with feature 019 FR-007; accordion items that unmount by default MUST be kept mounted).
- **FR-008**: Workspace module components MUST be renamed to reflect their rendered role and follow the project's component naming conventions.
- **FR-009**: Item headers MUST support keyboard navigation (arrow keys move selection across items).
- **FR-010**: All feature-019 header affordances MUST be preserved: pack tooltips, crash indicator, × close-to-disable, and the stack MUST remain usable when many items exist (scrolling).

### Key Entities

- **Workspace Item**: an expandable unit in the workspace — identity, title, kind (`chat` | extension view | pack workspace), selected state (unchanged model from feature 019).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Surface switches feel instant while animating — transition completes in under ~300 ms with no visible reload flicker of chat or extension content.
- **SC-002**: 100% of feature-019 behaviors still pass: enable→item appears, disable/remove→item closes, Browse→Open focuses the item, restore keeps Chat selected.
- **SC-003**: Keyboard-only users can reach and select every workspace item without a pointer.
- **SC-004**: With reduced-motion enabled, transitions are instant with zero animation frames applied.

## Assumptions

- **A1**: "Update the component names" means renaming the workspace module's components/files to role-descriptive names consistent with the project's component conventions (no public API rename needed — internal module only).
- **A2**: "Other UX improvements" are bounded to the workspace tab surface: keyboard navigation, reduced-motion support, transition polish — not a broader restyle of ChatPage or the extensions drawer.
- **A3**: The accordion primitive is adopted through the project's component conventions (shadcn/ui wraps Radix) rather than importing Radix directly — consistent with the constitution's component-standardization principle.
- **A4**: The tab data model (`deriveTabs`/`reconcile`, `WorkspaceTab` union, selection rules) is unchanged — this feature changes presentation, not tab semantics.
