# Feature Specification: Local Voice Input

**Feature Branch**: `014-voice-input`

**Created**: 2025-11-24

**Status**: Draft

**Input**: User description: "Push-to-talk voice input via a locally-run speech-to-text engine — fully offline transcription into the composer, microphone device selection, voice-activity or manual recording control."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Dictate a message (Priority: P1)

A user holds a button (or toggles recording), speaks, releases — and the
transcribed text lands in the composer ready to edit or send. No audio
leaves the machine.

**Why this priority**: The headline value — hands-free dictation into a
fully local chat app, consistent with its offline posture.

**Independent Test**: Record a spoken sentence — the composer shows the
transcribed text, editable before sending.

**Acceptance Scenarios**:

1. **Given** a working microphone, **When** the user records speech and
   stops, **Then** the transcript appears in the composer.
2. **Given** a transcription in progress, **When** it completes, **Then**
   a busy indicator clears and the text is inserted without sending.
3. **Given** no transcription model installed, **When** the user activates
   voice input, **Then** the UI offers to download one via the existing
  model-management flow rather than erroring.

---

### User Story 2 - Device & model management (Priority: P2)

The user selects which microphone to use and which speech model to run;
the chosen model lives in the model library alongside chat models.

**Why this priority**: Real machines have multiple inputs; model choice
trades speed vs accuracy — both are table stakes for daily use.

**Independent Test**: Two input devices present — selecting the second
and recording uses it; switching the speech model changes transcription.

**Acceptance Scenarios**:

1. **Given** multiple input devices, **When** the user picks one,
   **Then** subsequent recordings use it.
2. **Given** a downloaded speech model, **When** the user selects it,
   **Then** transcription uses it.

---

### Edge Cases

- No microphone / permission denied: voice button disables with a clear
  reason; typing is unaffected.
- Recording while a generation is streaming: voice capture is
  independent (different engine), allowed, and non-blocking.
- Very long recordings are capped with an indicator rather than
  unbounded memory use.
- Silence-only recording produces an empty/no-op transcript, not an
  error.
- Speech model file missing after selection: voice input degrades to a
  "re-download" notice; typing unaffected.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to record speech via a push-to-talk or
  toggle control and receive an offline transcription in the composer.
- **FR-002**: Transcription MUST insert into the draft without
  auto-sending — the user reviews/edits first.
- **FR-003**: The app MUST list available audio input devices and let the
  user select one.
- **FR-004**: Speech models MUST be managed through the existing model
  library/download flow, distinct from chat models.
- **FR-005**: Recording MUST be time-capped with a visible indicator of
  recording state and elapsed time.
- **FR-006**: Microphone absence or permission denial MUST disable voice
  input gracefully with a stated reason.
- **FR-007**: Voice capture MUST NOT block or be blocked by a generation
  in progress.
- **FR-008**: Silence or undecodable audio MUST produce an empty result,
  not an error.
- **FR-009**: All audio capture and transcription MUST run locally —
  zero network access for this feature.
- **FR-010**: Native audio/engine work MUST follow the existing native
  shim + FFI conventions with typed handles and bounded lifetimes.

### Key Entities

- **Speech model**: a transcription model file in the library, typed
  separately from chat GGUFs.
- **Recording session**: `{ deviceId, startedAt, durationMs,
  audioBuffer }` — bounded capture.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A 10-second dictation transcribes in under 5 seconds on the
  dev host with a small speech model.
- **SC-002**: Transcription of clear speech achieves high accuracy
  (subjectively correct on validation sentences).
- **SC-003**: With no microphone present, the app remains fully usable
  with voice input disabled.
- **SC-004**: Zero audio data leaves the device (verified by offline
  operation).
- **SC-005**: All existing gates pass and no pre-existing test regresses.

## Assumptions

- A local speech-to-text engine (whisper.cpp or equivalent) is vendored
  the same way llama.cpp is; engine choice is a planning decision.
- Text output only in v1 — no speaker diarization, timestamps, or
  streaming partial transcripts.
- OS-level microphone permission flows are handled by the platform.
