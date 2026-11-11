# Quickstart — Validation Scenarios

## VS-1: export a conversation (US1)

1. Conversation with user/assistant turns + a fenced code block (and a
   fusion plan if available) → conv menu → Export → Markdown.
2. Open the file: reads as a transcript, `**You**`/`**Assistant**`
   blocks in order, code fenced, plan in `<details>`.
3. Export → JSON: `formatVersion: 1`, `kind: "conversation"`, all
   messages incl. `parentId`/`activeLeaf`/`phases`/`stats`.
4. `grep -E '"(path|Dir|/"|:)' file.json | grep -E '/home|C:\\'` → no
   absolute paths.

## VS-2: import round-trip (US2)

1. Export JSON → delete the conversation → Import → file appears with
   identical message content, fresh ids.
2. Import the same file twice → two distinct conversations, no
   overwrite.
3. Import a truncated/garbage `.json` → `INVALID_PARAMS` naming the
   problem; conversation list unchanged.
4. Import the 008 backup file via `conversation.import` → typed error.

## VS-3: backup & restore (US3)

1. Data panel → Export backup → envelope with all conversations +
   settings + tags.
2. Fresh profile (`APP_DATA_DIR` to an empty dir) → Import backup →
   conversations restored, generation params + tags present.
3. Backup bound to a model absent locally → tag shows `broken`, user
   re-binds — no crash.

## VS-4: variant trees (post-005 regression check)

1. Conversation with regenerate/edit variants → JSON export → import.
2. Imported conversation shows identical ‹ n/m › variant sets and the
   same displayed path.
