# Research — 007-conversation-search

## D1 — Index strategy: lazy `updatedAt`-keyed refresh, no FTS library

**Decision**: in-memory per-conversation index. On each `search.query`,
`listConversations()` gives `{id, title, updatedAt, personaName}`;
conversations whose `updatedAt` is unchanged keep their cached entries;
changed/new ones are re-read via `getConversation` and re-scanned;
missing ones are evicted. Matching is case-insensitive literal substring
over lowercased text — multi-word queries split on whitespace and
require ALL terms present in the same searchable unit.

**Rationale**: the store is already per-conversation JSON; `updatedAt`
is maintained by every mutation path (`persist`, rename, setMode,
setPersona, delete). No write hooks needed — staleness is impossible by
construction, and external file edits self-heal. A 1,000-message corpus
is ~1–2 MB of text; a linear scan is far under the 300 ms SC-001 bound,
so a real FTS index (sqlite/fts5, MiniSearch, lunr) buys nothing and
costs a dependency + rebuild complexity (VI).

**Alternatives considered**:
- `bun:sqlite` FTS5 — persistent, ranked, but introduces a second store
  to keep consistent with the JSON source of truth (FR-006 invalidation
  becomes a sync problem). Rejected for VI/FR-006.
- Scan-on-query with no cache — simplest, but re-reads every file per
  keystroke; the `updatedAt` cache is ~20 lines and removes that.

## D2 — Searchable unit & plan-phase coverage (FR-001/FR-007)

**Decision**: one index entry per **message** whose `status` is
`complete` or `partial` (FR-009 excludes `generating`/`failed`).
`searchableText = content + "\n" + (phases?.plan?.content ?? "")`.
All branch variants are indexed — the tree is flat (`messages[]`), so
variants and dead branches are searchable like the active path.
Title matches are checked against the conversation title separately and
surface the conversation even with zero message hits (US1 scenario 3).

## D3 — Result shape & ordering (FR-003/FR-004)

**Decision**: `search.query` returns groups ordered by conversation
`updatedAt` desc, capped at 20 conversations. Each group carries up to 3
hits; each hit = `{messageId, role, timestamp, snippet}` where snippet
is the first term's match centered in ~80 chars of context, marked up
with the byte range of the match for renderer highlighting
(`snippet` + `matchStart`/`matchEnd` avoids shipping markup in RPC).
`titleMatched: boolean` when only the title hit.

## D4 — Jump-to-message on a branched tree (FR-005)

**Decision**: reuse feature-005 tree helpers — after hydrating the
conversation, set `activeLeaf = deepestLeaf(messages, hit.message)` so
the matching variant becomes the displayed path, then
`message.selectVariant` isn't needed (display-only navigation mirrors
`selectVariant`'s fast path but WITHOUT persisting — a read should not
mutate the user's chosen branch). Scroll: `MessageList` gets a
`scrollToId` prop → `element.scrollIntoView` + a transient highlight
ring on the target message.

## D5 — Sidebar integration & debounce (US2)

**Decision**: the existing "Filter chats…" input becomes the search
box. Query ≥3 chars → `search.query` (debounced ~250 ms, stale-response
guard via request sequence number) and the list swaps to grouped
results; <3 chars → normal filtered conversation list. Empty-result
state names the query. Deleted conversations vanish naturally (index
evicts on next query — FR-006/edge case).

## D6 — Special characters / case (edge cases)

Literal substring only — the query is never parsed (no regex, no query
language); `toLowerCase()` both sides, so `C++`, `[foo]`, `?` all match
literally. Assumption: no boolean syntax in v1 (spec Assumptions).
