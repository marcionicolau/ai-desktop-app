# Feature Specification: Multi-Agent Workspace & Extension Plugins

**Feature Branch**: `017-multi-agent-plugin-ui`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "Criar a especificação completa para fornecer uma interface para trabalhar com multi-agent spec like in https://github.com/marcionicolau/spec-agents using a mechanism for extensions plugins like /home/marcio/codes/cnpt/agents/legal-saas that could load UI components for extension use, research about best design pattern for this"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install and Manage Extension Packs (Priority: P1)

A user adds an extension pack to the app (for example, a domain pack that
bundles agents, skills, and pipelines the way spec-agents domain packs do,
delivered the way legal-saas delivers its legal pack). The app discovers the
pack, reads its manifest, checks compatibility, and shows the user what the
pack contributes — agent trees, skills, pipelines, commands, and UI views —
before the user enables it. The user can enable, disable, and remove packs
without restarting the app, and a broken or incompatible pack never prevents
the rest of the app (or other packs) from working.

**Why this priority**: Nothing else in the feature exists without the
extension mechanism. Discovery, manifest validation, compatibility gating,
and lifecycle management are the foundation every other story builds on, and
they are independently valuable: a user can install a pack and inspect its
declared contributions even before running anything.

**Independent Test**: Install a valid extension pack and an intentionally
incompatible one; verify the valid pack lists its contributions and can be
enabled/disabled/removed, while the incompatible pack is rejected with a
clear reason — all without touching any other feature.

**Acceptance Scenarios**:

1. **Given** a folder containing a valid extension manifest, **When** the
   user installs it, **Then** the pack appears in the extension list with its
   name, version, declared capabilities, and contributed items.
2. **Given** an extension whose declared API level is incompatible with the
   host, **When** the user installs it, **Then** the pack is rejected (or
   disabled) with a human-readable incompatibility reason and no
   contributions are registered.
3. **Given** an enabled extension, **When** the user disables it, **Then**
   all of its contributions (agents, skills, pipelines, UI views, commands)
   disappear from the app immediately, without an app restart.
4. **Given** an extension with a malformed manifest, **When** the app scans
   the extensions directory, **Then** that pack is listed as failed with a
   located error while all other packs load normally.
5. **Given** an extension that declares it wants to execute code or access
   local resources, **When** the user enables it, **Then** the app asks for
   explicit consent describing the granted capabilities before activation.

---

### User Story 2 - Browse Multi-Agent Specs Contributed by Extensions (Priority: P2)

With at least one pack enabled, the user opens a workspace view that shows
the pack's declared content: hierarchical agent trees (supervisors,
planners, sub-agents), skills/components with their typed inputs and
outputs, and pipelines expressed as DAGs. The user can inspect each item's
contract — its description, parameters, input/output ports, and usage
guidance — exactly as spec-agents treats frontmatter as contract and body as
guidance.

**Why this priority**: This is the "interface for working with multi-agent
spec" half of the request. Browsing and understanding what a pack offers is
a prerequisite to running anything, and it is independently testable against
static pack content.

**Independent Test**: Enable a pack that declares agents, skills, and
pipelines; verify each appears in the workspace browser with its contract
details visible and correct.

**Acceptance Scenarios**:

1. **Given** an enabled pack with an agent tree, **When** the user opens the
   workspace, **Then** the tree renders with its hierarchy and each agent's
   kind, model role, and sub-agents visible.
2. **Given** an enabled pack with skills and pipelines, **When** the user
   selects one, **Then** its typed inputs, outputs, parameters, and guidance
   text are displayed read-only.
3. **Given** two enabled packs that both contribute an item named the same,
   **When** the user browses the workspace, **Then** items are namespaced by
   pack so no collision or ambiguity occurs.

---

### User Story 3 - Run and Monitor an Agent Tree or Pipeline (Priority: P2)

From the workspace, the user picks a runnable target (an agent tree root or
a pipeline), enters an objective and any required parameters, and starts a
run against the app's configured models. The user watches live progress —
which agent or pipeline step is active, delegation path, and produced
outputs — can cancel the run, and afterwards inspects the trace and
artifacts. Run history is kept per pack.

**Why this priority**: Running packs is the end-user payoff of the feature.
It depends on Story 1 (a pack must be enabled) but is testable with a single
small pack and a stub or fast local model.

**Independent Test**: Enable a pack with one pipeline, run it with an
objective, watch live status transitions, and confirm the produced artifacts
and trace are viewable after completion.

**Acceptance Scenarios**:

1. **Given** an enabled pack with a runnable pipeline, **When** the user
   starts a run with valid parameters, **Then** the run appears with live
   per-step status until it completes, fails, or is cancelled.
2. **Given** a running agent tree, **When** a sub-agent delegates, **Then**
   the UI reflects the delegation path so the user can follow which agent is
   active.
3. **Given** a completed run, **When** the user opens it from history,
   **Then** the full trace, per-step outputs, and final artifacts are shown.
4. **Given** a run that fails inside the extension, **When** the failure
   occurs, **Then** the user sees a typed, located error and the host app
   remains fully functional.
5. **Given** a run in progress, **When** the user cancels, **Then** the run
   stops promptly, is marked cancelled, and releases any held resources.

---

### User Story 4 - Extension-Contributed UI Components (Priority: P3)

An extension can ship its own UI: panels, views, or whole workspace tabs
that render inside designated host areas (the way legal-saas pairs its pack
with a dedicated web UI). The host loads these components into isolated
slots, so an extension can provide a rich custom experience — for example a
results explorer or a domain-specific editor — while a crash, slow render,
or script error inside the extension UI never takes down or corrupts the
host.

**Why this priority**: This is the differentiating ask ("load UI components
for extension use") and the highest-risk area, which is why it follows the
proven core. It is independently demonstrable: a pack contributing only a UI
view exercises the whole loading and isolation path.

**Independent Test**: Install a pack contributing a UI view plus a pack
whose UI intentionally throws; verify the first renders in its slot and the
second is contained to an error placeholder in its slot only.

**Acceptance Scenarios**:

1. **Given** an enabled pack that contributes a UI view, **When** the user
   opens the contributed surface, **Then** the extension's UI renders inside
   the designated host slot.
2. **Given** an extension UI that crashes or throws, **When** the error
   occurs, **Then** only that slot shows an error state; the host and other
   extensions continue working, and the user can reload the view.
3. **Given** an extension UI, **When** it renders, **Then** it can only
   reach host capabilities through the declared extension API — it cannot
   read arbitrary files, other extensions' data, or host internals.
4. **Given** an extension UI and the host app, **When** the user switches
   theme or language in the host, **Then** the extension view receives the
   change so it can stay visually consistent.

---

### Edge Cases

- Extension uninstalled or disabled while one of its runs is in progress:
  the run is cancelled cleanly and marked with the reason.
- Two extensions contributing conflicting identifiers: namespacing by pack
  prevents collisions; duplicates within one pack are a manifest error.
- A run fails inside the host runtime while executing a pack's logic: the
  run fails with a typed, located error naming the pack and step; the host
  offers retry, not app restart.
- Extension UI requests a capability it did not declare: the request is
  denied and surfaced to the user.
- Host upgraded so a previously compatible pack becomes incompatible: the
  pack auto-disables with an explanatory notice, never crashes the app.
- Extension with no UI contribution at all (headless pack): everything above
  still works; UI contributions are optional.
- Extensions directory missing or empty on first launch: the feature shows a
  friendly empty state with install guidance.

## Requirements *(mandatory)*

### Functional Requirements

**Extension lifecycle**

- **FR-001**: The system MUST discover extension packs from a defined
  extensions location, reading each pack's manifest that declares its
  identity (name, version), compatibility (host API level), capabilities
  required, and contributions.
- **FR-002**: The system MUST validate each manifest before registering any
  contribution; malformed or incompatible packs MUST be rejected with a
  located, human-readable error and MUST NOT affect other packs or the host.
- **FR-003**: Users MUST be able to install (from a local folder, archive, or
  remote URL/registry per FR-019), enable, disable, and remove extension
  packs without restarting the app.
- **FR-004**: The system MUST persist each pack's enabled/disabled state
  across app restarts.
- **FR-005**: Before enabling a pack that declares execution or
  resource-access capabilities, the system MUST obtain explicit user consent
  describing those capabilities.
- **FR-006**: The system MUST namespace every contribution by its pack so
  identically named items from different packs cannot collide.

**Contributions & multi-agent workspace**

- **FR-007**: The system MUST maintain a registry of contributions from all
  enabled packs covering at minimum: agent trees, skills/components,
  pipelines, commands, and UI views.
- **FR-008**: The system MUST present a workspace browser where users can
  inspect each contributed agent tree's hierarchy, each skill's typed
  contract (inputs, outputs, parameters, guidance), and each pipeline's DAG.
- **FR-009**: The system MUST allow users to start a run of an agent tree or
  pipeline by providing an objective and required parameters.
- **FR-010**: The system MUST stream run progress to the UI, including the
  active step or agent, delegation path, and status transitions, and MUST
  allow cancellation.
- **FR-011**: The system MUST retain a per-pack run history with trace and
  produced artifacts, viewable after completion.
- **FR-012**: All failures originating in an extension MUST surface as typed
  errors with location/context, and MUST never propagate as host crashes.

**Extension UI loading & isolation**

- **FR-013**: The system MUST render extension-contributed UI components
  inside designated host slots, each isolated so that a fault in one
  extension's UI cannot affect the host or other extensions.
- **FR-014**: Extension UI MUST access host capabilities exclusively through
  the declared extension API surface; undeclared access MUST be denied and
  surfaced.
- **FR-015**: The system MUST notify extension views of host context changes
  relevant to appearance and behavior (e.g., theme).
- **FR-016**: The system MUST offer users a way to reload a failed extension
  view without reloading the app.

**Execution model**

- **FR-017**: The host MUST embed a generic multi-agent runtime that executes
  packs' declared agent trees, skills, and pipelines; packs are declarative
  (contracts, specs, and UI contributions only) and MUST NOT be required to
  ship their own compute runtime.
- **FR-018**: The system MUST route model access for extension runs through
  the app's own configured model layer so users pick models once for host
  and extensions alike.
- **FR-019**: Users MUST be able to install packs from local sources (folder
  or archive file) AND from a remote location via a simple URL/registry
  fetch; a browsable marketplace is out of scope for v1.
- **FR-020**: For remotely fetched packs, the system MUST show the pack's
  identity, version, and declared capabilities, and MUST obtain the same
  explicit consent as local packs before enabling.

### Key Entities

- **Extension Pack**: A versioned bundle declared by a manifest; carries an
  identity, a required host API level, requested capabilities, and a set of
  contributions; has a lifecycle state (installed, enabled, disabled,
  failed, removed).
- **Agent Tree**: A hierarchy of agents (supervisors, planners, workers)
  contributed by a pack; each agent has a kind, a model role, optional
  sub-agents, and fallback behavior.
- **Skill / Component**: A declared unit of work with typed input/output
  ports, parameters, and usage guidance; may be deterministic or
  prompt-backed.
- **Pipeline**: A directed acyclic graph of components with parameter
  bindings, contributed by a pack and runnable with an objective.
- **Run**: A single execution of an agent tree or pipeline; has status
  (queued, running, completed, failed, cancelled), a trace of steps and
  delegations, produced artifacts, and an owning pack.
- **UI Contribution**: A view/panel/tab declared by a pack, rendered in a
  host slot under isolation, communicating only through the extension API.
- **Extension API**: The bounded capability surface exposed to packs:
  model invocation, run reporting, storage scoped to the pack, and host
  context notifications.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can install and enable a valid extension pack and see
  its contributions in under 2 minutes, with no app restart.
- **SC-002**: 100% of extension faults — bad manifest, runtime crash, UI
  exception — are contained to that extension; the host and other enabled
  packs remain fully usable in every fault-injection test.
- **SC-003**: A user can go from "pack enabled" to "run started" in 3 or
  fewer interactions from the workspace browser.
- **SC-004**: A first-time user can complete a full pipeline run and open
  its trace and artifacts without external documentation, in under 10
  minutes.
- **SC-005**: At least 3 extensions can be enabled simultaneously and used
  interchangeably with no cross-talk between their contributions, runs, or
  UI views.
- **SC-006**: Disabling or removing an extension while its run is active
  leaves zero orphaned runs or leaked resources; 100% of such runs end in a
  terminal, clearly-labelled state.
- **SC-007**: 90% of incompatibility or manifest errors are understood and
  resolved by users without consulting logs outside the app (measured via
  the in-app error message alone in usability testing).

## Assumptions

- The inspiration sources define the vocabulary: spec-agents contributes
  the domain-pack concept (packs declare agent trees, skills, pipelines via
  manifest-like contracts and a declared API level) and legal-saas
  contributes the extension shape (domain pack + an optional dedicated UI
  for the pack's domain). Per FR-017, packs are declarative — the spec-agents
  notion of code-backed components maps to the host runtime's built-in
  component library in v1.
- Extension UI contributions still execute code inside the app, so packs
  are treated as untrusted: consent on enable (FR-005), a bounded extension
  API (FR-014), and isolated UI rendering (FR-013) are baseline, not
  optional. Remote fetch (FR-019) adds provenance display before enable.
- Extension-contributed UI renders in isolated, sandboxed view surfaces
  (industry-standard for untrusted UI code); the specific rendering
  technology is a planning decision.
- Model access is centralized in the host (FR-018): the app already manages
  local models, and extensions request generation through the extension API
  rather than configuring their own backends.
- Run history and extension state live in the app's existing local data
  storage; no cloud sync is in scope.
- v1 targets a single-user desktop context; multi-user packaging, signing,
  and a browsable marketplace are out of scope (FR-019 limits remote
  distribution to URL/registry fetch).
- The existing chat features are unaffected; this feature adds a new
  workspace surface rather than changing the chat experience.
