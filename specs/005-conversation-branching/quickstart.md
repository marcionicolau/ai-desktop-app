# Quickstart: Conversation Branching Validation

Prereqs: built native shim, ≥1 GGUF in `models/`, `bun run dev`.

## VS-1 — Regenerate preserves variants (US1; FR-001, FR-003)

1. Send a message; wait for the answer.
2. Regenerate twice → the assistant message shows a `‹ 1/3 ›`-style
   indicator; prev/next flips between all three answers.
3. Send a follow-up while displaying variant 2 → the model's context is
   variant 2's answer (verify by asking "what did you just say").
4. Restart → variants and the active path persist.

## VS-2 — Edit creates a branch (US2; FR-002)

1. In a multi-turn conversation, edit a mid-conversation user message
   and resend.
2. Expect: edited variant + fresh answer shown; `‹ 1/2 ›` on the user
   message; switching to variant 1 restores the original message AND its
   original answer sub-tree.
3. Sending continues from the displayed variant only.

## VS-3 — Branch overview (US3; FR-003)

1. Create ≥2 branch points (one regenerate, one edit).
2. Open the branch overview → each point lists variants with previews;
   clicking one navigates to it.

## VS-4 — Gates + invariants (FR-006, FR-007, SC-005)

1. During a generation, variant navigation is disabled (ENGINE_BUSY
  if forced).
2. `bun run typecheck && bun run lint && bun test ./tests &&
    bun run build:renderer && bun run build:native` — all green.
3. Legacy conversation (pre-005 data) opens correctly and gains branch
   capability on first regenerate.
