# Data Model — Conversation Branching

## `Message` (extended)

```ts
interface Message {
  // existing fields unchanged
  parentId?: string | null;   // NEW — id of the preceding message on its
                              // branch; null/undefined = first in conv or
                              // legacy pre-005 message (linear backfill)
}
```

- **Variant set**: all messages sharing the same `parentId` (including
  the implicit null-set for top-of-conversation roots, though in
  practice only one root exists).
- **Branch point**: a `parentId` value with ≥2 children.
- Variant ordering = stable insertion order in `messages[]` (ties by
  `createdAt`).

## `Conversation` (extended)

```ts
interface Conversation {
  // existing fields unchanged
  activeLeaf?: string | null; // NEW — id of the deepest message on the
                              // displayed branch; null = last message in
                              // array order (legacy default)
}
```

## Derived views (computed, never stored)

```ts
pathOf(conv): Message[]        // ancestors of activeLeaf, root-first
siblings(conv, m): Message[]   // all msgs with parentId === m.parentId
children(conv, m): Message[]   // all msgs with parentId === m.id
deepestLeaf(conv, m): Message  // walk down from m; at each level pick the
                               // latest-createdAt child
variantIndex(m): { pos, total }// m's position among siblings
```

## State transitions

- `chat.send` — user msg `parentId` = activeLeaf; assistant child same.
  New conv: user msg `parentId = null`, `activeLeaf` = assistant id.
- `chat.regenerate` — new assistant msg, `parentId` = the target's
  `parentId`; `activeLeaf` = new id.
- `chat.edit` — new user msg (edited text), `parentId` = target's
  `parentId`; new assistant child; `activeLeaf` = assistant id.
- `message.selectVariant` — `activeLeaf` = `deepestLeaf(target)`.
- `chat.stop` / `chat.done` / `chat.error` — no tree mutation (status on
  the streaming message only).

## Migration (lazy, load-time)

Conversations without `parentId` get linear backfill on first load:
`messages[i].parentId = messages[i-1].id`, `activeLeaf` = last message
id. Same pattern as the 004 field-defaults backfill — write-through on
next save.

## Invariants

- `activeLeaf` always references an existing message id (or null on
  empty conv).
- A message's subtree is never partially deleted by edit/regenerate —
  variants are append-only. `conversation.delete` still removes all.
- Sibling sets are ordered; variant indicator is `pos+1/total`.
- Fusion `phases` are per-variant (each assistant variant owns its plan).
