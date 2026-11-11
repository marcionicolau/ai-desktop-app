# RPC Contract: Model Roles & Fusion

New requests under `role.*`, one `conversation.setMode`, extended events.
Renderer stays native-blind (constitution II).

## New requests

| Method | Params | Response | Errors |
|---|---|---|---|
| `role.list` | `{}` | `{ tags: (ModelTag & { state: RoleState; resolvedFile?: ModelMeta })[] }` | — |
| `role.create` | `{ name, label?, description? }` | `{ tag: ModelTag }` | `INVALID_PARAMS` (slug), `ALREADY_EXISTS` |
| `role.update` | `{ name, label?, description?, params?: Partial<GenerationParams>\|null }` | `{}` | `NOT_FOUND`, `INVALID_PARAMS` |
| `role.delete` | `{ name, force?: boolean }` | `{}` | `NOT_FOUND`, `ROLE_IN_USE` (name consumers) |
| `role.bind` | `{ name, fileName: string \| null }` | `{}` | `NOT_FOUND`, `MODEL_NOT_FOUND` |
| `role.setFallback` | `{ name, chain: RoleRef[] }` | `{}` | `NOT_FOUND`, `INVALID_PARAMS` (cycle/self/len>3) |
| `role.resolve` | `{ name }` | `{ resolved: ResolvedRole; candidates: ResolvedRole[] }` (ordered for the runtime cascade) | `NOT_FOUND`, `ROLE_UNBOUND`, `MODEL_NOT_FOUND` |
| `conversation.setMode` | `{ conversationId, mode: "single"\|"fusion", plannerTag?, executorTag? }` | `{}` | `NOT_FOUND`, `INVALID_PARAMS`, `ROLE_UNBOUND` (names the missing tag) |

## Changed requests

- `model.download`: params add optional `tagName` → binds on `done`
  (D8). New error `NOT_FOUND` if tag missing (validated upfront, before
  download starts).
- `chat.send`: params add optional `mode?`, `plannerTag?`, `executorTag?`
  — applied only when this send creates the conversation (draft chats can
  open in fusion mode); existing conversations use `conversation.setMode`.
- `chat.regenerate` / `chat.edit`: unchanged signatures — fusion behavior
  is selected by `conversation.mode`.

## New / changed events (`webview.messages`)

- `chat.token`: `{ messageId, delta, phase?: "plan" \| "answer" }` —
  `phase` present only in fusion turns.
- `chat.phase`: `{ messageId, phase: "plan"\|"answer", tag, fileName,
  servedBy: "primary"|"fallback" }` — marks phase transitions; renderer
  opens the plan block on `plan`, closes it on `answer`.
- `chat.done.stats`: `{ plan?: MessageStats, answer?: MessageStats,
  total?: MessageStats }` (was flat `MessageStats`).
- `role.changed`: `{ name }` — broadcast after any role.* mutation so
  open panels refresh.
- `model.download` event: unchanged shape; the bind step emits
  `role.changed` after `done`.

## New error codes

`ROLE_UNBOUND` (tag has no resolvable candidate), `ROLE_IN_USE`
(delete-blocked — message lists consumers).

## Sequencing invariants

- A fusion turn emits: `chat.phase(plan)` → `chat.token{phase:plan}`* →
  `chat.phase(answer)` → `chat.token{phase:answer}`* → `chat.done`.
- A stopped turn may emit `chat.done{status:"partial"}` after the plan
  phase only.
- `chat.error` can arrive at either phase; `code` distinguishes
  `ROLE_UNBOUND`/`MODEL_INVALID`/`ENGINE_ERROR`/`ENGINE_BUSY`.
