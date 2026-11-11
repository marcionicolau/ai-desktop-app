# Feature Specification: Cross-Platform Packaging Validation

**Feature Branch**: `012-cross-platform-packaging`

**Created**: 2025-11-24

**Status**: Draft

**Input**: User description: "Cross-platform packaging validation — verify and document macOS + Windows builds alongside Linux: per-OS native library staging, signing/notarization notes, and a repeatable smoke-test checklist per platform."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Repeatable per-OS build + smoke check (Priority: P1)

A maintainer runs the documented packaging flow on macOS and Windows and
gets a working app artifact, then walks a short smoke checklist —
launch, load a model, send a message, streaming works — identical to the
Linux flow already used.

**Why this priority**: The project claims cross-platform support but only
Linux has a validated path today; the other two OSes are unverified
promises.

**Independent Test**: On a macOS or Windows machine, follow the doc —
produce an artifact that launches and completes one chat turn.

**Acceptance Scenarios**:

1. **Given** a clean macOS checkout, **When** the documented build runs,
   **Then** a launchable artifact containing the correct native libraries
   (.dylib set) is produced.
2. **Given** a clean Windows checkout, **When** the documented build
   runs, **Then** a launchable artifact with the correct .dll set is
   produced.
3. **Given** any produced artifact, **When** the smoke checklist runs,
   **Then** launch → model load → chat → streaming all pass.

---

### User Story 2 - CI packaging matrix (Priority: P2)

Packaging runs in CI for all three OSes on tags/PRs, uploading artifacts
and failing visibly on regressions — so "does it still build on Windows"
is answered continuously, not by hand.

**Why this priority**: Manual validation decays instantly; CI makes
cross-platform support durable.

**Independent Test**: Push a change touching native code — CI builds all
three platforms and reports per-OS pass/fail with artifacts.

**Acceptance Scenarios**:

1. **Given** a CI matrix for linux/mac/windows, **When** a build runs,
   **Then** each OS produces its artifact or the job fails with a
   platform-named error.
2. **Given** a failed native build on one OS, **When** CI reports,
   **Then** the failing platform is identifiable without digging through
   a combined log.

---

### User Story 3 - Signing & distribution notes (Priority: P3)

Documented guidance for code signing/notarization (macOS) and signing
(Windows) so releases can be distributed without Gatekeeper/SmartScreen
blocks; unsigned-dev-build caveats are explicit.

**Why this priority**: Distribution polish — required for real releases
but not for development validation.

**Independent Test**: Following the notes on a signed cert produces a
notarized/signed artifact (or the doc clearly marks the step optional
for dev builds).

**Acceptance Scenarios**:

1. **Given** signing credentials, **When** following the doc, **Then**
   macOS output is notarized and Windows output is signed.
2. **Given** no credentials, **When** reading the doc, **Then** the
   unsigned-build workaround per OS is documented.

---

### Edge Cases

- Native library name/layout differences per OS (.so/.dylib/.dll +
  versioning) must resolve at runtime, not just link time.
- Architecture variants (x64 vs arm64 on macOS/Windows) — artifacts must
  be labeled or universal per documented policy.
- Missing toolchain prerequisites per OS fail fast with a named
  prerequisite, not a cryptic compiler error.
- Runtime library search path issues (e.g. Windows DLL resolution,
  macOS @rpath) are exercised by actually launching the packaged app.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The build MUST produce a working artifact on macOS
  (x64 and/or arm64 per documented policy) and Windows (x64) equivalent
  to the existing Linux flow.
- **FR-002**: Each platform's native library set MUST stage into the
  packaged artifact with runtime-loadable layout.
- **FR-003**: A documented smoke checklist MUST exist per OS: launch,
  model load, chat send, token streaming.
- **FR-004**: Build failures MUST name the missing prerequisite or
  platform-specific cause.
- **FR-005**: A CI matrix MUST build all three OSes and surface per-OS
  results with downloadable artifacts.
- **FR-006**: Signing/notarization steps MUST be documented with
  unsigned-dev-build caveats.
- **FR-007**: Architecture policy (x64 vs arm64 vs universal) MUST be
  documented and reflected in artifact naming.
- **FR-008**: The packaged app MUST resolve native libraries at runtime
  on all three OSes without manual environment setup.
- **FR-009**: All packaging flows MUST remain reproducible from a clean
  checkout.
- **FR-010**: No feature-behavior changes — identical app functionality
  on every platform.

### Key Entities

- **Platform artifact**: packaged app + staged native libraries per
  OS/arch.
- **Smoke checklist**: ordered validation steps per OS.
- **CI matrix**: per-OS build jobs with artifact upload.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A clean-checkout build produces a working artifact on all
  three OSes.
- **SC-002**: The smoke checklist passes on all three platforms
  (launch → load → chat → stream).
- **SC-003**: CI reports per-OS pass/fail on every run with artifacts
  available for download.
- **SC-004**: Time to a working macOS or Windows build from clean
  checkout is under 30 minutes excluding toolchain install.
- **SC-005**: All existing gates pass and no pre-existing test regresses.

## Assumptions

- Maintainer access to real macOS and Windows machines (or CI runners)
  exists; this spec cannot be fully validated on Linux alone.
- Code-signing credentials are org-managed secrets, documented but never
  committed.
- Linux packaging stays as the reference implementation.
