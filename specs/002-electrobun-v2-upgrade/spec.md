# Feature Specification: Electrobun v2 Upgrade

**Feature Branch**: `002-electrobun-v2-upgrade`

**Created**: 2026-11-11

**Status**: Draft

**Input**: User description: "Usar Electrobun versão 2.0 e fazer todos os devidos ajustes para a aplicação funcionar usando a documentação do projeto e melhores praticas da comunidade"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - App Runs on the New Shell (Priority: P1)

A developer launches the project in dev mode and the app window opens exactly
as before: the renderer loads with live reload, the main process starts
cleanly, and every existing feature behaves identically — nothing the user
could see or do under the old desktop shell is missing or broken.

**Why this priority**: The upgrade is worthless if the app doesn't run. This is
the entire point of the change and is independently verifiable.

**Independent Test**: Run the documented dev command, confirm the window opens
with the UI, make a renderer source edit and confirm live reload, then run the
packaged dev build and confirm it launches.

**Acceptance Scenarios**:

1. **Given** a clean checkout with dependencies installed, **When** the
   documented dev command runs, **Then** the app window opens showing the
   renderer UI without console errors.
2. **Given** the dev session is running, **When** a renderer source file
   changes, **Then** the UI updates via live reload without restarting.
3. **Given** a packaged build completes, **When** the produced app is
   launched, **Then** it opens the same UI as the dev session.

---

### User Story 2 - Release Pipeline Produces Installers (Priority: P2)

A maintainer runs the release build on each supported operating system and
gets installable artifacts that launch correctly, including the bundled
native inference libraries in their expected locations.

**Why this priority**: Shipping is the purpose of the shell. Without working
packaging, the app only exists in dev.

**Independent Test**: Run the release build command on an available OS,
install/launch the artifact, and confirm native libraries are present in the
bundle and loadable.

**Acceptance Scenarios**:

1. **Given** the release build command, **When** it runs to completion,
   **Then** an installable artifact exists in the documented output folder.
2. **Given** a packaged build, **When** inspecting the bundle, **Then** the
   native inference libraries are present at the path the app resolves at
   runtime.
3. **Given** the installer artifact, **When** launched, **Then** the app's
   model-loading path can locate the bundled native library.

---

### User Story 3 - Single Documented Toolchain (Priority: P3)

A contributor reads the project files and finds exactly one configuration for
the desktop shell — following the current version's documented conventions —
with no stale files from the previous tooling generation and no ambiguity
about which commands to run.

**Why this priority**: Keeps the repo self-explanatory and prevents drift
between "the docs say" and "what actually builds". Lower value than a working
app, but cheap insurance.

**Independent Test**: List config files at repo root — exactly one shell
config exists, uses the current documented schema, and every documented
script/command in it works.

**Acceptance Scenarios**:

1. **Given** the repository root, **When** configs are inspected, **Then**
   there is exactly one desktop-shell config file and it matches the current
   version's documented format.
2. **Given** the documented commands, **When** each is invoked, **Then** each
   succeeds without referencing removed tooling.

---

### Edge Cases

- Config from the old shell version left alongside the new one — must not
  coexist or silently conflict.
- Dev mode works but packaged build fails (or vice versa) — both paths are
  validated, not just one.
- Native library staging path differs between versions — the app's runtime
  resolution must match wherever the new bundler places them.
- Version-specific features (updater channels, new renderer options) have
  different defaults — documented choices rather than accidental inheritance.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST run in dev mode under the new shell version with
  the renderer served with live reload.
- **FR-002**: Release builds MUST produce launchable, installable artifacts
  on every supported operating system.
- **FR-003**: No user-facing functionality MUST regress relative to the
  previous shell version (window, renderer, RPC, native inference).
- **FR-004**: Exactly one desktop-shell configuration file MUST exist,
  conforming to the new version's documented schema.
- **FR-005**: Native inference libraries MUST be staged into the app bundle
  under the new bundling rules and resolvable at runtime.
- **FR-006**: Project configuration MUST follow the current version's
  documented conventions and community best practices (config file names,
  script entrypoints, resource layout).
- **FR-007**: All project quality gates (strict typecheck, lint, renderer
  build) MUST pass after the migration.
- **FR-008**: The migration MUST preserve existing spec/plan/task intent —
  changes are confined to shell/tooling config and its consumers.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Dev command → interactive window in under 15 seconds on a
  typical dev machine.
- **SC-002**: 100% of previously defined user scenarios behave identically
  after the migration.
- **SC-003**: Release build completes and yields an installable artifact on
  every available target OS.
- **SC-004**: Zero remaining config files or scripts referencing the
  superseded tooling generation.
- **SC-005**: Typecheck, lint, and renderer build all exit 0 after migration.

## Assumptions

- "Versão 2.0" means the Electrobun 2.x line (Hutch build orchestrator); the
  exact minor is the latest stable at migration time.
- The Vite-built renderer strategy is retained (framework templates still run
  their own build, per current docs); only config/staging mechanics change.
- Native library approach (C shim + `dlopen`) is unchanged conceptually;
  only bundle staging/resolution paths may need adjustment.
- Community best practices means matching the official template/config
  schema (`electrobun.config.ts` + `hutch.config.ts`, documented `build.copy`
  / views layout) rather than bespoke workarounds.
- The existing `types/electrobun.d.ts` shim may be unnecessary if v2 ships
  valid type declarations — kept or removed based on what ships.
