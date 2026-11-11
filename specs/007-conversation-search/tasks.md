# Tasks — 007-conversation-search

**Input**: spec.md, plan.md, research.md, data-model.md, contracts/rpc.md
**Prerequisites**: plan.md complete (commit `docs(007)`)

## Phase 1 — Foundational (backend index + contract)

All stories depend on the index + RPC; complete before US1/US2.

- [X] T001 `src/shared/types.ts`: add `SearchHit` (`messageId, role,
  timestamp, snippet, matchStart, matchEnd`), `SearchGroup`
  (`conversationId, title, updatedAt, personaName?, titleMatched, hits`),
  and `SearchResponse` per data-model.md.
- [X] T002 `src/shared/rpc-contract.ts`: add
  `"search.query": { params: { q: string }; response: { groups: SearchGroup[] } }`.
- [X] T003 `src/bun/search/index.ts`: `SearchIndex` class — per-conversation
  cache `Map<id, {updatedAt, title, personaName, entries}>`; `refresh`
  walks `listConversations()`, re-reads convs whose `updatedAt` changed,
  evicts missing (research D1); `entries` from `messages[]` where
  `status` is `complete`/`partial`, `searchableText = content + "\n" +
  phases.plan.content` lowercased (FR-007/FR-009).
- [X] T004 `src/bun/search/index.ts`: `query(q)` — trim; `<3` chars →
  empty; whitespace-split terms, ALL-terms AND literal substring
  (lowercased, no regex — D6); title terms → `titleMatched`; snippet =
  ~80 chars centered on first term match + `matchStart`/`matchEnd`;
  groups sorted `updatedAt` desc, capped 20 conversations / 3 hits each
  (earliest message first).
- [X] T005 [P] `tests/bun/search.test.ts`: multi-term AND, case-insensitive,
  literal special chars (`C++`, `[foo]`), generating/failed excluded,
  plan-phase hit, deleted/updatedAt-eviction, group order + caps,
  snippet centering + match range.
- [X] T006 `src/bun/rpc/handlers.ts`: lazy `searchIndex` singleton +
  `"search.query"` handler returning `index.query(q)`; wire the dep-free
  index (uses `deps.store`) into `HandlerDeps`-level closure only.
  Also bump `conv.updatedAt` at the `chat.done`/`chat.error` persists —
  without it a query mid-generation would cache the conv forever with
  the `generating` message excluded (FR-006/SC-003).
- [X] T007 `tests/rpc/search.test.ts`: query → grouped response,
  title-only group, empty/short query → `[]`, mid-generation message
  absent then present after done (updatedAt refresh).

## Phase 2 — US1 (P1): find past answers by content

**Goal**: sidebar search box → grouped results → click opens conv at the
matching message.
**Independent Test**: two convs with distinct terms; search one — only
the right conv surfaces, snippet highlights match, click navigates to
the exact message.

- [X] T008 [US1] `src/renderer/src/features/chat/Sidebar.tsx`: search box
  (existing "Filter chats…" input repurposed); query ≥3 chars →
  `search.query` RPC (debounced ~250 ms, seq-guard for stale responses),
  list swaps to grouped results: title + snippet rows with `<mark>`
  highlight via `matchStart/matchEnd`, `titleMatched` badge for
  title-only hits, empty state names the query; <3 chars → normal list.
- [X] T009 [US1] `src/renderer/src/features/chat/use-chat.ts`:
  `selectConversation(id, targetMessageId?)` — after hydrate, if a
  target is given set `activeLeaf = deepestLeaf(messages, target)` so the
  matching variant path displays (D4: display-only, NO
  `message.selectVariant` persist); expose `scrollTarget` in state,
  cleared on next hydrate.
- [X] T010 [US1] `src/renderer/src/features/chat/MessageList.tsx`:
  `scrollToId` prop — `useEffect` → `getElementById`/`ref` →
  `scrollIntoView({block:"center"})` + transient highlight ring
  (~2 s) on the target message; needs stable `id={m.id}` on message
  nodes.
- [X] T011 [US1] `src/renderer/src/features/chat/ChatPage.tsx` +
  `Sidebar.tsx`: click hit → `selectConversation(conversationId,
  hit.messageId)` end-to-end wiring.

## Phase 3 — US2 (P2): incremental UX polish

**Goal**: debounced refine-per-keystroke, honest empty states.
**Independent Test**: 4-letter query refines per keystroke; clear →
normal sidebar.

- [X] T012 [US2] `Sidebar.tsx`: debounce + request-sequence guard
  (out-of-order responses dropped), "Searching…" affordance while a
  query is in flight, `No results for "q"` state, Esc/blur clears back
  to list.
- [X] T013 [US2] `tests/bun/search.test.ts` / `tests/rpc/search.test.ts`:
  cover VS-2 paths — 2-char query → `[]`, rapid successive queries each
  fresh (no stale cache bleed), title-vs-body precedence ordering.

## Phase 4 — Polish

- [X] T014 Write `specs/007-conversation-search/validation.md` mapping
  VS-1/VS-2 + edge cases to test evidence and gates.
- [X] T015 Gates: `bun test`, `tsc --noEmit`, `oxlint`, `hutch run build`;
  append module notes to `AGENTS.md` (`search/` dir, RPC, scroll-target
  pattern).

## Dependencies & notes

- US1 (T008–T011) needs T001–T006; US2 (T012–T013) needs T008.
- MVP scope: T001–T011 ships the whole P1 story alone.
- Parallel: T005 ∥ T006; T012 ∥ T013.
- Every mutation already bumps `updatedAt` → FR-006 freshness is free;
  no write hooks on the store (research D1).
