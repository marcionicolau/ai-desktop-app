# Validation — Feature 005 Conversation Branching

## Automated evidence

| Scenario | Result | Evidence |
|---|---|---|
| VS-1 regenerate keeps alternates; send continues from displayed variant | PASS | `tests/rpc/branch.test.ts` — 3 variants coexist, original untouched incl. stats/phases (FR-008/FR-009), `activeLeaf` advances; "send continues from the displayed variant" asserts `parentId` chains to the v2 leaf |
| VS-2 edit creates branch; subtree swap | PASS | `branch.test.ts` — user sibling + fresh child, original subtree intact (6 msgs after edit), `selectVariant(u1)` → `a1` / `selectVariant(edited)` → `a2` subtree swap |
| VS-4 legacy backfill | PASS | `tests/store/tree.test.ts` — `backfillTree` linear chain + `activeLeaf`; explicit `null` roots preserved (regression: `??=` re-chaining bug caught + fixed) |
| `selectVariant` guards | PASS | `ENGINE_BUSY` while generating, `NOT_FOUND` unknown message |
| SC-002 switch < 100 ms | PASS | measured **~1.1 ms/switch** on a 1,020-message fixture (100 iterations of `deepestLeaf`+`pathOf` via the client mirror) |
| SC-005 all gates | PASS | typecheck · lint · **111/111 tests** · `build:renderer` · `build:native` |

## Live-GUI steps (manual pass — headless env)

1. Send → answer; Regenerate twice → `‹ 3/3 ›` on the assistant turn.
2. `‹`/`›` cycles variants; send a follow-up → continues the displayed one.
3. Edit a mid-conversation user turn → `‹ 2/2 ›` on the user message; switching swaps the whole subtree.
4. GitBranch toolbar icon → overview lists branch points; click navigates. Restart app → branch state persists.
