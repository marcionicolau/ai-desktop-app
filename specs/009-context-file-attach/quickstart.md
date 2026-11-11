# Quickstart — 009-context-file-attach

## VS-1 — Attach and send (US1)

1. Paperclip in the composer → pick `src/bun/llama/prompt.ts`.
2. A chip shows `prompt.ts · 3.4 KB` with a ×.
3. Send "what does this file do?" → answer references `buildPrompt` /
   `PromptTurn` — real symbols, not guesses.
4. The sent user message shows the `prompt.ts` chip in history.
5. Restart the app → chip still there (SC-003).

## VS-2 — Oversized file (US2)

1. Attach a file larger than the context budget.
2. Send → generation succeeds; a `chat.warning` notice says the file was
   truncated at a line boundary (or excluded).
3. The message's chip marks the status; nothing fails silently (SC-002).

## VS-3 — Binary + dedup + regenerate

1. Pick a `.png` or `.so` → it lands in the rejected list with a reason
   at attach time — no chip, no send-time surprise (SC-004).
2. Re-pick the same file twice → one chip, one id (FR-007).
3. Send with an attachment → regenerate that turn → the regeneration
   uses the identical file content (FR-009).

## VS-4 — Fusion (FR-008)

1. In fusion mode attach a file and send.
2. The plan phase runs off the request + attachment summary (names and
   sizes); the executor phase answers with file content in context.
