# Research — Conversation Branching & Message Trees

## D1 — Variant storage model: flat array + `parentId` (chosen)

`Conversation.messages` stays a flat, append-only `Message[]`. Each
`Message` gains `parentId?: string | null`; a variant set = messages
sharing a `parentId`. `Conversation.activeLeaf` points at the deepest
message of the currently-displayed branch; the displayed path is the
ancestor chain of `activeLeaf`.

**Rationale**: zero schema rewrite; persisted data remains a plain list
(backward/forward compatible); path derivation is O(depth) — trivial at
chat sizes; append-only writes keep the atomic-write store safe.

**Alternatives considered**:
- *Nested tree* (`Message.children[]`): more natural shape but a hard
  migration, harder atomic updates, and every consumer (persistence,
  search, export, history builder) rewrites — rejected.
- *Per-branch-point `activeChildId` map*: equivalent expressiveness but
  redundant — the active leaf already determines every displayed
  ancestor — rejected as duplicate state that can drift.

## D2 — Active-path & history derivation

`pathOf(conv)` = walk `parentId` chain from `activeLeaf` to root,
reversed. Generation history (`turnsBefore`) operates on this path
instead of an array slice. Siblings of message `m` = all messages where
`parentId === m.parentId` (sorted by `createdAt`/insertion order);
variant index = position of `m` in its sibling list.

**Rationale**: a single pure module (`store/tree.ts`) holds
`pathOf/siblings/children/deepestLeaf` — testable without RPC, reused by
handlers, store migration, and (mirrored) the renderer.

**Alternatives**: computing path server-side per request vs shipping all
messages to the renderer — chose shipping the flat array (see D4).

## D3 — Variant switching semantics

`message.selectVariant { messageId }` sets `activeLeaf` to the deepest
descendant leaf of the target variant (ties broken by latest
`createdAt`). Switching is pure navigation — no data mutation beyond the
leaf pointer, fully undoable by switching back. Variant display is
blocked while `generating` (single-flight invariant already enforced).

**Rationale**: "switch to a variant" must switch its whole subtree;
deepest-leaf gives a deterministic, total rule without extra state.

**Alternatives**: per-branch-point remembered selection — extra state
for marginal UX gain (deepest-leaf matches intuition: the branch you
last explored continues).

## D4 — Contract shape: ship flat messages + `activeLeaf`

`conversation.get` returns the existing `Conversation` (now carrying
`parentId`/`activeLeaf`). The renderer derives the displayed path with
the same `pathOf` logic (small pure function, duplicated client-side —
no new shared module needed). New request `message.selectVariant` is
the only added RPC; `chat.edit`/`chat.regenerate` keep signatures but
change semantics (create siblings instead of mutate/delete).

**Rationale**: minimal contract surface; renderer already receives all
messages and can compute path/sibling info locally — no per-click round
trip, satisfying SC-002 (<100 ms switches).

**Alternatives**: server-resolved `path` field — duplicates data in the
payload and hides variant structure from the UI — rejected.

## D5 — Regenerate/edit semantics under branching

- `chat.regenerate { messageId }`: still restricted to the last
  assistant message on the active path; creates a NEW assistant sibling
  (same `parentId`), sets it `activeLeaf`, streams into it. The prior
  variant is untouched (no content reset).
- `chat.edit { messageId, content }`: creates a NEW user sibling with
  the edited content (same `parentId`), plus a fresh assistant child;
  the original variant's subtree is preserved — `deleteMessagesAfter`
  is no longer used by edit.
- `deleteMessagesAfter` remains exported (used by tests/cleanup paths)
  but stops being on the edit path.

**Rationale**: FR-001/FR-002 literally — alternates preserved; the
streaming driver (`streamAssistant`) needs only an assistantMsg +
history + current text and is unchanged.
