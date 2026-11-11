# Feature Specification: Chat Quality & Model Management

**Feature Branch**: `003-chat-quality-models`

**Created**: 2025-11-11

**Status**: Draft

**Input**: User description: "Generation quality controls (sampling params, KV
reuse, real token counting, configurable generation), chat UX polish built on
Radix UI AI components (markdown rendering, message actions, search, stats),
and model management (GGUF metadata library, HuggingFace download, per-model
params)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Tuned Generation (Priority: P1)

A user adjusts how the model generates replies — creativity (temperature),
diversity (top-p/top-k), repetition penalty, reproducibility (seed), and
maximum reply length — and sees visibly different behavior, including fewer
degenerate repetition loops than the default deterministic mode.

**Why this priority**: The smoke test showed greedy-only decoding produces
loops and confabulation; sampling control is the single biggest quality lever
and is independently verifiable by changing one setting and re-sending.

**Independent Test**: Set a nonzero temperature, send the same prompt twice,
and confirm the replies differ; set a repeat penalty and confirm fewer
verbatim repeats than the baseline.

**Acceptance Scenarios**:

1. **Given** default settings, **When** the user changes a sampling
   parameter and sends a message, **Then** generation uses the new value.
2. **Given** a fixed seed, **When** the same prompt is sent in two fresh
   conversations, **Then** outputs are reproducible (identical under greedy
   or same-seed sampling).
3. **Given** a max reply length, **When** generation reaches it, **Then**
   output stops cleanly and is marked as truncated rather than erroring.

---

### User Story 2 - Fast Multi-Turn Chat (Priority: P2)

A user holding a long conversation notices that follow-up replies start
streaming nearly as fast as the first message did, instead of slowing down
linearly as history grows — because prior turns are not re-processed from
scratch each time.

**Why this priority**: Currently every turn re-tokenizes and re-decodes the
full conversation, so each message gets slower. Reuse is a large, measurable
latency win for the most common interaction pattern.

**Independent Test**: Send 3+ sequential messages in one conversation and
measure time-to-first-token on the last message vs. a cold first message —
it must be significantly lower than a full re-decode.

**Acceptance Scenarios**:

1. **Given** a conversation with prior turns, **When** a new message is sent,
   **Then** only the new content is processed before generation starts.
2. **Given** history was dropped due to context limits or the model was
   reloaded, **When** a message is sent, **Then** the engine falls back to a
   fresh full prompt decode without error.

---

### User Story 3 - Rich Chat Surface (Priority: P3)

A user reads replies with formatted markdown (headings, lists, tables) and
syntax-highlighted code blocks; can copy any message, regenerate the last
reply, edit-and-resend their own message; search conversations from the
sidebar; and see per-reply stats (tokens generated, tokens/second).

**Why this priority**: Pure usability — the chat already works; this makes
it pleasant. Each sub-capability is small and shippable independently.

**Independent Test**: Ask for a code sample → rendered as a highlighted
block; click regenerate → new variant replaces/appends; type in sidebar
search → list filters.

**Acceptance Scenarios**:

1. **Given** a reply containing markdown/code, **When** it renders, **Then**
   formatting and syntax highlighting are applied (built with the project's
   Radix/shadcn component conventions).
2. **Given** a completed assistant message, **When** "regenerate" is chosen,
   **Then** a fresh generation replaces that turn and persists.
3. **Given** several conversations, **When** the sidebar filter is typed
   into, **Then** titles filter live.

---

### User Story 4 - Model Library & Downloads (Priority: P4)

A user opens a model panel showing every GGUF in the models folder with
parsed metadata (architecture, parameter size, quantization, context
length); downloads a new model by pasting a HuggingFace link and watching
progress; and sets per-model defaults (context size, max tokens, threads).

**Why this priority**: Removes the manual file-management step and makes
model choice informed. Valuable but not required for chat to function.

**Independent Test**: Drop a second .gguf into the models dir → appears in
the library with correct metadata; paste a small-model HF URL → downloads
with progress and becomes loadable.

**Acceptance Scenarios**:

1. **Given** GGUF files in the models directory, **When** the library opens,
   **Then** each shows parsed metadata (name, arch, quant, ctx train).
2. **Given** a HuggingFace model/resolve URL, **When** download starts,
   **Then** progress emits until the file lands and is loadable.
3. **Given** a per-model setting override, **When** that model loads,
   **Then** its values apply instead of global defaults.

---

### Edge Cases

- Sampling params set to degenerate values (temperature 0 vs. extreme 2.0)
  must be clamped/validated, not crash the sampler.
- KV-reuse invalidation: model unload, conversation switch, context
  truncation mid-chat, or app restart must not produce corrupted output.
- Download interrupted mid-file → partial file is cleaned up or resumable;
  a corrupt download must never be presented as loadable.
- Regenerate while a generation is in-flight is rejected (single-engine).
- Edited message mid-history → subsequent turns re-generate consistently.
- Model folder missing or empty → library shows an empty state with
  guidance, not an error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to configure sampling: temperature, top-p,
  top-k, repetition penalty, and seed — persisted as settings and applied to
  new generations.
- **FR-002**: Users MUST be able to configure generation bounds: max reply
  tokens and context size per model load.
- **FR-003**: Generation MUST end cleanly at the token cap or context limit
  (no hard error); over-long history MUST continue to be truncated with the
  existing warning.
- **FR-004**: Token estimation for context budgeting MUST use the model's
  actual tokenizer, not a character heuristic, where a tokenizer is
  available.
- **FR-005**: Multi-turn sends MUST reuse prior context state when the
  conversation and model are unchanged; falls back to a full re-decode
  whenever reuse is impossible (truncation, model reload, restart, conv
  switch).
- **FR-006**: Assistant replies MUST render markdown with syntax-highlighted
  code blocks; UI components MUST follow the existing shadcn/Radix stack.
- **FR-007**: Users MUST be able to copy a message, regenerate the last
  assistant reply, and edit+resend a user message (deleting later turns).
- **FR-008**: Users MUST be able to filter conversations in the sidebar by
  title substring.
- **FR-009**: Each completed assistant reply SHOULD display generation stats
  (token count, tokens/second).
- **FR-010**: The app MUST provide a model library listing local GGUF files
  with metadata parsed from each file (name, architecture, parameter count,
  quantization, trained context length).
- **FR-011**: Users MUST be able to download a GGUF from a HuggingFace
  resolve URL with visible progress; partial downloads MUST be detectable
  and removable.
- **FR-012**: Users MUST be able to set per-model default generation
  parameters that override global defaults when that model loads.
- **FR-013**: All new behavior MUST preserve existing guarantees: typed RPC,
  single-flight generation, persistence semantics, and FFI ownership rules.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With temperature > 0, two identical prompts produce different
  outputs; with a fixed seed and greedy sampling they produce identical
  outputs.
- **SC-002**: Time-to-first-token on turn N (N≥3, unchanged model+conv) is
  ≤30% of a cold-start equivalent prompt, measured once in dev.
- **SC-003**: A code-block reply renders highlighted; copy button copies the
  raw message text.
- **SC-004**: A ≥200 MB model download completes with progress events and
  loads successfully.
- **SC-005**: All existing gates remain green (typecheck, lint, tests,
  renderer + native builds) plus new tests covering param plumbing, KV
  reuse, regeneration, and metadata parsing.

## Assumptions

- "Radix UI AI components" = extending the existing shadcn/Radix component
  set with AI-chat-oriented pieces (markdown renderer, code block with copy,
  message action bar) — no new component library dependency beyond a
  markdown renderer and a syntax highlighter.
- Sampling/params are global settings plus optional per-model overrides;
  changing them mid-generation does not retroactively affect the in-flight
  message.
- KV reuse is best-effort within a single loaded model + single
  conversation; any doubt (truncation, reload, restart) falls back to full
  re-decode — correctness over speed.
- HuggingFace downloads use direct `resolve/` URLs (no auth/API tokens in
  v1 of this feature).
- GPU offload (`n_gpu_layers`) is exposed as a setting but hardware support
  varies — CPU remains the guaranteed path.
- Token/sec stats are display-only (main-process measured, event-carried).
