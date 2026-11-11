# Implementation Plan: Cross-Conversation Search

**Branch**: `007-conversation-search` | **Date**: 2026-11-11 | **Spec**: [spec.md](./spec.md)

## Summary

Full-text search over all persisted conversations — titles and message
bodies (including fusion plan-phase content), grouped by conversation,
jump-to-message navigation. Approach: a main-process in-memory index
that lazily refreshes per-conversation on `updatedAt` change (rebuild is
transparent, no persistence needed — FR-008), exposed through one typed
`search.query` RPC. The sidebar swaps its list for grouped results when
the query is ≥3 chars (debounced); selecting a hit hydrates the
conversation, switches to the matching variant path, and scrolls the
message into view.

## Technical Context

**Language/Version**: TypeScript (strict) — Bun main + React renderer
**Primary Dependencies**: existing stack only — Electrobun RPC,
`json-store`, feature-005 message trees; **no new packages** (VI)
**Storage**: none — index is memory-only, rebuilt transparently (FR-008)
**Testing**: `bun test` — pure index unit tests + RPC contract tests
**Target Platform**: Electrobun desktop (Linux/macOS/Windows)
**Project Type**: desktop-app
**Performance Goals**: SC-001 — 1,000 messages → results <300 ms
**Constraints**: fully local (FR-010), typed RPC (II), strict TS (III)
**Scale/Scope**: top-20 conversations per query, all stored messages

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Local-first** — index reads local JSON only; no network. PASS
- **II. Process boundaries** — search executes main-side; one typed
  request/response pair; renderer renders results. PASS
- **III. Strict TS** — `SearchHit`/`SearchGroup` shared types; literal
  substring matching needs no FFI. PASS
- **VI. Minimal deps** — substring scan + `updatedAt`-keyed refresh; no
  FTS library added (justified in research D1). PASS

## Project Structure

### Documentation (this feature)

```text
specs/007-conversation-search/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/rpc.md
├── quickstart.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
src/bun/search/index.ts        # in-memory index + query (pure, testable)
src/bun/rpc/handlers.ts        # "search.query" handler + wiring
src/shared/types.ts            # SearchHit, SearchGroup
src/shared/rpc-contract.ts     # "search.query" request
src/renderer/src/features/chat/Sidebar.tsx    # search box → results mode
src/renderer/src/features/chat/use-chat.ts    # selectConversation(targetMsg)
src/renderer/src/features/chat/MessageList.tsx # scroll-to + highlight
tests/bun/search.test.ts       # index unit tests
tests/rpc/search.test.ts       # contract: grouping/order/caps/filters
```

**Structure Decision**: search lives next to the store in `src/bun/search/`;
renderer changes are confined to the existing chat feature files.

## Complexity Tracking

No violations.
