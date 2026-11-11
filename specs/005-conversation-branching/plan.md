# Implementation Plan: Conversation Branching & Message Trees

**Branch**: `005-conversation-branching` | **Date**: 2025-11-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-conversation-branching/spec.md`

## Summary

Replace overwrite semantics in `chat.edit`/`chat.regenerate` with a
variant tree: every `Message` gains `parentId`, `Conversation` gains
`activeLeaf`, and regenerate/edit create *sibling* messages while the
original sub-trees stay reachable. The active path is derived by walking
`activeLeaf`'s ancestors — siblings are messages sharing a `parentId`.
UI adds per-message variant navigation (‹ n/m ›) plus an optional
branch-point overview. Storage stays a flat append-only array — cheap
migration, no schema rewrite.

## Technical Context

**Language/Version**: TypeScript strict (Bun 1.4.x)
**Primary Dependencies**: Electrobun 2.x typed RPC, React 19, Tailwind v4, shadcn/ui — no new deps
**Storage**: existing `json-store.ts` (conversations/*.json)
**Testing**: `bun test` — unit (store/tree ops), RPC contract, integration
**Target Platform**: linux/mac/windows desktop (Electrobun)
**Performance Goals**: variant switch <100 ms on 1000-message conv (SC-002)
**Constraints**: single-flight generation invariant; fully offline;
append-only store stays atomic-write safe
**Scale/Scope**: ~4 new/changed modules main-side, ~3 renderer files, ~6 RPC surface changes

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status |
|---|---|
| I. Local-first inference | PASS — no inference changes; history source becomes tree path, still local |
| II. Electrobun boundaries, typed RPC only | PASS — `message.selectVariant` + extended get/edit/regenerate go through `rpc-contract.ts` |
| III. Strict TS, typed FFI | PASS — no FFI changes; `parentId`/`activeLeaf` typed in `types.ts` |
| IV. shadcn/Tailwind UI | PASS — variant picker composes existing Button/message-action conventions |
| V. No new dependencies | PASS — tree ops are pure TS |
| Persistence atomicity | PASS — same atomic-write JSON store |

## Project Structure

### Documentation (this feature)

```text
specs/005-conversation-branching/
├── plan.md              # this file
├── research.md          # Phase 0 — model/contract/UX decisions
├── data-model.md        # Phase 1 — Message.parentId, activeLeaf, path derivation
├── quickstart.md        # Phase 1 — VS-1..VS-4 validation scenarios
├── contracts/
│   └── rpc.md           # changed chat.edit/regenerate, new message.selectVariant
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
src/
├── shared/
│   ├── types.ts              # + Message.parentId, Conversation.activeLeaf
│   └── rpc-contract.ts       # + message.selectVariant; semantics notes
├── bun/
│   ├── store/
│   │   ├── json-store.ts     # lazy parentId backfill on load
│   │   └── tree.ts           # NEW — pathOf, siblings, children, deepestLeaf
│   └── rpc/
│       └── handlers.ts       # edit/regenerate → sibling creation; selectVariant
└── renderer/src/
    ├── features/chat/
    │   ├── use-chat.ts       # tree-aware hydrate/reducer, selectVariant
    │   ├── MessageList.tsx   # path render + variant picker wiring
    │   └── VariantNav.tsx    # NEW — ‹ n/m › control
    └── (MessageActions unchanged API)
tests/
├── store/tree.test.ts        # NEW — path/sibling/leaf derivation
├── rpc/branch.test.ts        # NEW — regenerate/edit/selectVariant contract
└── existing suites stay green (chat.test.ts adapts where semantics changed)
```

**Structure Decision**: extends existing layout — one new pure module
(`store/tree.ts`) keeps tree logic testable without RPC; all other changes
are in-place edits to established files.

## Phase 0/1 outputs

`research.md` (5 decisions), `data-model.md`, `contracts/rpc.md`,
`quickstart.md` — see files.

## Complexity Tracking

No constitution violations — table empty.
