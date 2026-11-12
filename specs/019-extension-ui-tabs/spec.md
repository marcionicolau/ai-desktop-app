# Feature Specification: Extension UI Tabs

**Feature Branch**: `019-extension-ui-tabs`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "criar uma especificação para que cada extensão instalada e habilitada, abra sua UI em uma nova aba (com titulos na parte de cima) na qual a primeira aba é o componente ChatPage.tsx e assim sucessivamente para cada extensão habilitada"

## Clarifications

### Session 2026-11-12

- Q: When a pack is enabled and its extension tab appears, should the new tab take focus immediately, or appear unselected in the background? → A: Auto-select on enable (and on consent-gated enable); restart restore adds tabs without stealing focus.
- Q: If a `tab`-slot view already has a top tab, what should Browse → Open do — focus the existing tab, or allow a second copy of the view in the drawer? → A: Focus the existing tab — one view session per `tab` view; Browse → Open switches to it instead of spawning a drawer duplicate.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Extension views become peer tabs of Chat (Priority: P1)

As a user, when I enable an extension pack that declares a tab view, its UI appears as a new tab next to my Chat tab, so I can switch between chat and extension surfaces with one click instead of hunting through the extensions drawer.

**Why this priority**: This is the core ask — extension UIs are currently buried inside the extensions drawer (Browse → Open). Making them peer tabs is the entire feature value; everything else is polish.

**Independent Test**: Enable a pack declaring a `tab` view → a new titled tab appears in the top tab bar → clicking it shows that extension's live UI → clicking the Chat tab returns to the unchanged conversation.

**Acceptance Scenarios**:

1. **Given** no enabled packs, **When** the app starts, **Then** only the Chat tab is visible and it is selected.
2. **Given** an installed pack declaring a `tab` view, **When** the user enables it (with consent if required), **Then** a new tab titled with the view's declared title appears after the Chat tab and its UI loads inside it.
3. **Given** several enabled packs with `tab` views, **When** the user looks at the tab bar, **Then** each enabled `tab` view has its own titled tab; Chat is always first.
4. **Given** a selected extension tab, **When** the user switches to Chat and back, **Then** the extension UI's state is preserved (no reload).

---

### User Story 2 - Tabs follow the pack lifecycle live (Priority: P1)

As a user, tabs appear and disappear in the same session as packs are enabled, disabled, or removed — no restart needed.

**Why this priority**: A tab bar that requires restart to reflect pack state breaks the lifecycle story from feature 017 and feels broken; it shares P1 because it's required for the feature to be honest.

**Independent Test**: With the app running, disable an enabled pack → its tab(s) close immediately; re-enable → they reappear; remove a pack → its tabs close.

**Acceptance Scenarios**:

1. **Given** an enabled pack with a visible tab, **When** the user disables the pack, **Then** its tab closes and the selection falls back to a sensible neighbor (Chat if the closed tab was selected).
2. **Given** a disabled pack, **When** the user re-enables it, **Then** its tab(s) reappear without restart.
3. **Given** a removed pack, **When** the user removes it, **Then** its tab(s) close permanently.
4. **Given** a pack with an enabled `tab` view, **When** the app restarts, **Then** its tab is restored alongside Chat (state survives restart via existing extension persistence) and selection stays on Chat or the previously selected tab.
5. **Given** a `tab` view open as a top tab, **When** the user clicks Open for that view in the Browse surface, **Then** its existing top tab is selected — no second copy of the view opens in the drawer.

---

### User Story 3 - Tab bar communicates pack identity and problems (Priority: P2)

As a user, I can tell which pack owns each tab, and I can see when an extension UI has crashed, without leaving the current tab.

**Why this priority**: Trust and diagnosability — a crashed extension tab must not look like a frozen app. Lower than P1 because the core flow works without it.

**Independent Test**: Open the crash-view fixture's tab → the tab content shows the contained-crash state; the tab itself is identifiable.

**Acceptance Scenarios**:

1. **Given** an extension UI that throws during load, **When** the tab is shown, **Then** it displays the crashed state with a reload affordance, and other tabs keep working.
2. **Given** several extension tabs, **When** the user hovers a tab, **Then** the tooltip identifies the owning pack (name) as well as the view title.

---

### Edge Cases

- **Pack declares multiple `tab` views**: each declared view gets its own tab (Assumption A1).
- **Pack declares only `panel` views or no views**: contributes no top tab; panel views keep the existing drawer behavior.
- **Tab overflow**: with many enabled packs, the tab bar must remain usable (scroll/overflow affordance).
- **Tab view crashes while selected**: contained crash UI with reload stays inside its tab; other tabs unaffected.
- **Enabled pack fails to parse on restart**: shows as failed in the extensions list (existing behavior); contributes no tab.
- **Empty-title view**: falls back to the view id or pack name so the tab is never blank.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST present a top-level tab bar whose first tab is always Chat (the existing chat workspace), visible whenever at least one tab exists.
- **FR-002**: The Chat tab MUST be fixed in first position and MUST NOT be closable.
- **FR-003**: For every enabled extension pack, each view declared with the `tab` slot MUST produce a titled top-level tab hosting that view's UI.
- **FR-004**: Tab titles MUST come from the declared view title, falling back to the view id or pack name when absent.
- **FR-005**: Enabling a pack MUST add its `tab` view tab(s) in the same session without restart, and the newly added tab MUST take focus (auto-select); disabling or removing a pack MUST close its tab(s) in the same session.
- **FR-006**: On startup, enabled packs' `tab` views MUST be restored as tabs without stealing focus (previously selected tab, defaulting to Chat, remains selected).
- **FR-007**: Switching tabs MUST preserve the hidden tab's running state — Chat conversation state and extension view sessions must not be torn down on tab switch.
- **FR-008**: A crashed extension view MUST render its contained-crash state (with reload affordance) inside its own tab without affecting other tabs.
- **FR-009**: Tab tooltips MUST identify the owning pack name in addition to the view title.
- **FR-010**: When the selected tab closes (pack disabled/removed), selection MUST move to a sensible neighbor — Chat by default.
- **FR-011**: The tab bar MUST remain usable when many tabs exist (horizontal scroll or equivalent overflow handling).
- **FR-012**: `panel`-slot views and packs with no declared `tab` views MUST NOT create top tabs (unchanged drawer behavior).
- **FR-013**: Each `tab` view has exactly one live view session — opening it from Browse while its top tab exists MUST focus that tab, not spawn a duplicate session.

### Key Entities

- **Workspace Tab**: a top-level tab — identity, title, kind (`chat` | extension view), owning pack + view ids, order position, selected state.
- **Extension View Session**: the live hosted UI backing an extension tab (already modeled by feature 017 view sessions); a tab binds to one session.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Enabling a pack with a `tab` view makes its tab visible within 1 second of consent/enable, without restart.
- **SC-002**: 100% of enabled packs' declared `tab` views are reachable as tabs (none left undiscoverable behind Browse → Open).
- **SC-003**: Switching between any two tabs is instantaneous from the user's perspective (no visible reload of chat or extension content).
- **SC-004**: A crashed extension view affects 0 other tabs — Chat and other extension tabs remain interactive.
- **SC-005**: Tab lifecycle parity: disable/remove/re-enable state changes reflect in the tab bar within 1 second.

## Assumptions

- **A1**: Tabs are created per declared `tab`-slot view, not per pack — a pack with two `tab` views yields two tabs. Manifest declarations are the source of truth.
- **A2**: `panel`-slot views keep the current drawer-hosted behavior; only `tab`-slot views become top tabs.
- **A3**: The extensions management surface (pack list, workspace browser, run view) stays inside the Chat tab's existing drawer — this feature doesn't move it.
- **A4**: Tab order is Chat first, then extension views in enable/declaration order; no user tab reordering in v1.
- **A5**: Users cannot close extension tabs directly — they close by disabling/removing the owning pack (consistent with "extensions are declarative" model).
- **A6**: Extension view sessions already provide crash containment and reload (feature 017); this feature only re-hosts them at top level.
