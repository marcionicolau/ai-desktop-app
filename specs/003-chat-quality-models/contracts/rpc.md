# RPC Contract Delta — Feature 003

Additive to feature-001 `contracts/rpc.md` (11 methods + 5 events). New
total: **17 methods + 6 events**.

## New request methods

| Method | Params | Response | Errors |
|--------|--------|----------|--------|
| `settings.get` | `{}` | `{ generation: GenerationParams, modelOverrides: Record<string,Partial<GenerationParams>> }` | — |
| `settings.set` | `{ generation?: Partial<GenerationParams>, modelOverride?: { fileName: string, params: Partial<GenerationParams> \| null } }` | `{}` | `INVALID_PARAMS` |
| `chat.regenerate` | `{ messageId }` | `{ messageId }` — re-emits token stream for the SAME assistant turn | `NOT_FOUND`, `NO_MODEL`, `ENGINE_BUSY` |
| `chat.edit` | `{ messageId, content }` | `{ messageId }` — edits a user msg, deletes later turns, then behaves like `chat.send` | `EMPTY_MESSAGE`, `NOT_FOUND`, `NO_MODEL`, `ENGINE_BUSY` |
| `model.list` | `{}` | `{ models: ModelMeta[] }` — scans `models/` dir | — |
| `model.download` | `{ url, fileName }` | `{ fileName }` — progress via event; file lands in `models/` | `INVALID_URL`, `DOWNLOAD_FAILED`, `ALREADY_EXISTS` |
| `model.setOverride` | `{ fileName, params: Partial<GenerationParams> \| null }` | `{}` — convenience over `settings.set` | `INVALID_PARAMS` |

## Event changes

- `chat.done` payload extended: `{ messageId, status, stats?: { tokens,
  tokensPerSec } }`
- `model.download` (new event): `{ fileName, phase: "progress"|"done"|
  "error", downloadedBytes, totalBytes|null, error? }`

## New error codes

`INVALID_PARAMS` (out-of-range/clamped values), `INVALID_URL` (non-HF or
non-GGUF resolve URL), `DOWNLOAD_FAILED`, `ALREADY_EXISTS`.

## Semantics

- `chat.regenerate`: the last `complete|partial` assistant turn in its
  conversation is reset to `generating`, content cleared, and the stream
  replays; same `messageId` (UI updates in place). KV session invalidated.
- `chat.edit`: target user message's `content` is replaced and **all later
  turns deleted**; a new assistant `generating` turn follows — identical
  stream contract to `chat.send`.
- `model.download`: `fileName` must end `.gguf`; URL must match
  `huggingface.co/*/resolve/*`; partial → `.part` temp; done → atomic
  rename into `models/`.
- Param merge order at `model.load`: `defaults ← settings.generation ←
  modelOverrides[fileName]` — last wins per field.
