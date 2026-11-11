# RPC Contract: Renderer ↔ Main

Typed contract over Electrobun's built-in RPC bridge (constitution Principle
II). Definitions live in `src/shared/rpc-contract.ts` and are imported by both
processes — this document is the human-readable version.

## Requests (renderer → main, request/response)

| Method | Params | Returns | Errors |
|--------|--------|---------|--------|
| `model.load` | `{ path: string }` | `{ status: "ready", name: string }` | `MODEL_NOT_FOUND`, `MODEL_INVALID`, `OUT_OF_MEMORY`, `ENGINE_ERROR` |
| `model.unload` | `{}` | `{}` | — |
| `model.status` | `{}` | `{ status, name?, error? }` | — |
| `chat.send` | `{ conversationId, content }` | `{ messageId }` — response streams via events | `NO_MODEL`, `ENGINE_BUSY`, `EMPTY_MESSAGE` |
| `chat.stop` | `{ messageId }` | `{}` | `NOT_GENERATING` |
| `conversation.list` | `{}` | `ConversationSummary[]` (id, title, updatedAt) | — |
| `conversation.get` | `{ conversationId }` | `Conversation` with full messages | `NOT_FOUND` |
| `conversation.create` | `{ title? }` | `ConversationSummary` | — |
| `conversation.rename` | `{ conversationId, title }` | `{}` | `NOT_FOUND`, `EMPTY_TITLE` |
| `conversation.delete` | `{ conversationId }` | `{}` | `NOT_FOUND` |

## Events (main → renderer, fire-and-forget)

| Event | Payload | Semantics |
|-------|---------|-----------|
| `chat.token` | `{ messageId, delta }` | emitted per generated chunk while a response is in progress |
| `chat.done` | `{ messageId, status: "complete" \| "partial" }` | stream finished; `partial` = stopped |
| `chat.error` | `{ messageId, code, message }` | inference failed mid-generation |
| `model.progress` | `{ phase: "loading" \| "ready" \| "error", detail? }` | model lifecycle updates |

## Rules

- `chat.send` is rejected with `ENGINE_BUSY` while any generation is active
  (single-engine constraint; FR-012).
- `chat.token` order is guaranteed per `messageId`; renderer appends deltas.
- All payloads are JSON-serializable; no pointers or handles cross the bridge.
- Errors carry `{ code, message }` — `message` is human-readable (FR-007).
