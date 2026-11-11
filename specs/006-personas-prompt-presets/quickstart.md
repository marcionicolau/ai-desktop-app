# Quickstart — 006-personas-prompt-presets

## VS-1 Apply a persona (P1)

1. Settings → Personas shows seeded entries (concise/tutor/coder).
2. Pick `tutor` from the conversation header persona select.
3. Send a message — the answer reflects the tutor instructions; the
   turn's params reflect persona overrides.
4. Switch conversations — each keeps its own persona badge; unassign
   via the select's "none" entry and the next turn reverts to default.

## VS-2 Manage personas (P2)

5. Personas panel: create `reviewer` with a system prompt + temp 0.2 —
   persists across restart and appears in the header select.
6. Duplicate `coder` → `coder-2`, edit, delete `coder-2` — list updates.
7. Delete a persona in use → the panel names affected conversations;
   they keep working with default behavior.

## VS-3 Snippets (P3)

8. Save snippet `summarize` = "Summarize the above in 3 bullets.".
9. In the composer type `/sum` → filtered picker → Enter inserts the
   fragment at the cursor; send normally.

## Error paths

10. Upsert with empty/oversized systemPrompt or bad slug →
    `INVALID_PARAMS`; snippet named after a persona → `INVALID_PARAMS`.
11. `setPersona` with unknown name → `NOT_FOUND`; deleting an in-use
    persona clears assignments and reports `cleared`.
