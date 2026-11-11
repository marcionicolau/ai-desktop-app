# Data Model — Export & Import

## `ExportEnvelope` (new, `src/shared/export.ts`)

```ts
const EXPORT_FORMAT_VERSION = 1;

interface ExportEnvelope {
  formatVersion: number;      // === 1; import rejects != 1
  app: "ai-desktop-app";
  kind: "conversation" | "backup";
  exportedAt: string;          // ISO timestamp
  conversations: ExportedConversation[];  // exactly 1 when kind="conversation"
  settings?: ExportedSettings; // only kind="backup"
  tags?: ModelTag[];           // only kind="backup"
}

type ExportedConversation = Conversation; // verbatim incl. parentId/activeLeaf

interface ExportedSettings {
  generation: GenerationParams;
  modelOverrides: Record<string, Partial<GenerationParams>>;
  contextLimitWarning: boolean;
  activeModel: string | null;  // file BASENAME, not a path (FR-003)
}
```

## Invariants

- `formatVersion === 1`; unknown versions reject with `INVALID_PARAMS`.
- No field contains an absolute path (`/…` or `C:\…`) — `activeModel` is
  a basename; tag `binding`/`fallback` refs are already names.
- `kind="conversation"` ⇒ `settings`/`tags` absent;
  `kind="backup"` ⇒ both present.
- Messages export verbatim — `parentId`, `activeLeaf`, `phases`, `stats`
  all preserved so variant trees round-trip (feature 005).

## Import transitions (`importer.ts`)

```
envelope → validate → per-conversation remap:
  newConvId      = uuid()
  idMap[oldMsgId] = uuid()
  msg.parentId'   = idMap[parentId] ?? null   (dangling → null)
  conv.activeLeaf' = idMap[activeLeaf] ?? deepest valid leaf
  conv.id'        = newConvId
→ saveConversation(conv')              (atomic, existing primitive)
```

- Import NEVER merges into an existing conversation — always a new row.
- Backup restore additionally: `saveSettings({generation, modelOverrides,
  contextLimitWarning, tags: mergedTags, activeModelPath})` where
  `activeModelPath` resolves `activeModel` basename → `modelsDir()` path
  if the file exists, else `null`; `mergedTags` = backup tags +
  `provisionTags` defaults for any missing built-ins. Bindings to absent
  files are kept verbatim → `RoleView.state = "broken"` (FR-008).

## Validation rules (`parseEnvelope`)

| Check | Error |
|---|---|
| JSON parse fails | `INVALID_PARAMS` "not a JSON file" |
| `formatVersion !== 1` | `INVALID_PARAMS` "unsupported format version N" |
| `kind` not in enum / missing | `INVALID_PARAMS` "unknown export kind" |
| `conversations` empty or non-array | `INVALID_PARAMS` "no conversations in file" |
| a message lacks `id`/`role`/`content`/`status` | `INVALID_PARAMS` "malformed message at index i" |

All errors thrown before any write → zero partial writes (FR-006).
