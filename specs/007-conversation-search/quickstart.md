# Quickstart — 007-conversation-search

## VS-1 Find past answers (P1)

1. Have ≥2 conversations with distinct terms (e.g. "quantization",
   "webpack").
2. Sidebar box → type `quant` (≥3 chars) — results group under the right
   conversation with a highlighted snippet.
3. Click a hit — the conversation opens on the matching variant path,
   scrolled to the message with a brief highlight.
4. Search a term only in a title — the conversation appears with
   `titleMatched` styling even with no body hits.

## VS-2 Incremental search UX (P2)

5. Type 4+ chars — results refine per keystroke (~250 ms debounce), no
   submit needed.
6. Search `zzz-nothing` — "No results for 'zzz-nothing'" state.
7. Clear to <3 chars — normal conversation list returns.

## Edge cases

8. Search while a message streams — the `generating` message is absent
   until `chat.done`; after completion it appears (SC-003 ≤2 s: next
   keystroke/query sees it because `updatedAt` changed).
9. `C++` or `[foo]` — literal match, no errors.
10. Fusion message — a term in the plan phase matches the message.
11. Delete a conversation — it disappears from the next query.
