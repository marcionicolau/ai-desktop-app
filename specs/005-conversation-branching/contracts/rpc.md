# RPC Contract — Conversation Branching

Additions/changes to `src/shared/rpc-contract.ts`. All existing methods
keep their names and payload shapes unless noted.

## New requests

| Method | Params | Response | Errors |
|---|---|---|---|
| `message.selectVariant` | `{ messageId: string }` | `{ activeLeaf: string }` | `NOT_FOUND` (msg or conv), `ENGINE_BUSY` (generation in progress) |

Semantics: sets `conv.activeLeaf = deepestLeaf(messageId)` (research D3).
Pure navigation — no message data changes.

## Changed requests (same signatures, new semantics)

- **`conversation.get`** — response `Conversation` now includes
  `messages[].parentId?` and `activeLeaf?`. Renderer derives the
  displayed path via `pathOf` (client-side mirror of `store/tree.ts`).
- **`chat.regenerate { messageId }`** — creates a sibling variant
  instead of resetting content in place. Response `{ messageId }` is the
  NEW assistant variant's id. Still restricted to the last assistant
  message on the active path (`NOT_FOUND` otherwise).
- **`chat.edit { messageId, content, userMessageId? }`** — creates a
  user-message sibling plus a new assistant child; original subtree
  preserved. `userMessageId` is an optional client-assigned id for the
  user variant (same pattern as `chat.send`). Response `{ messageId }`
  is the new assistant message id (unchanged).
- **`chat.send`** — internal: new messages chain onto `activeLeaf`
  (params/response unchanged).
- **`conversation.delete`** — unchanged: removes the entire tree.

## Events

Unchanged. `chat.token`/`chat.done`/`chat.error`/`chat.phase` always
refer to the streaming (newest) message — variant switches never occur
mid-turn.

## Sequencing invariants

- A regenerate turn emits the same event sequence as `chat.send`, but on
  a NEW `messageId` (the variant), not the original.
- `message.selectVariant` while generating → `ENGINE_BUSY`.
- After any tree mutation, `activeLeaf` is valid per data-model
  invariants.
