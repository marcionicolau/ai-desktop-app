# Validation — 007-conversation-search

## Requirements → verification

| Requirement | Where verified |
|---|---|
| Search titles + message bodies, case-insensitive literal | `tests/bun/search.test.ts` |
| Multi-word AND matching | `tests/bun/search.test.ts` ("c++ template" both msgs) |
| Grouped by conversation, `updatedAt` desc, ≤20 groups / ≤3 hits | `tests/bun/search.test.ts` ordering+caps |
| Contextual snippet + `matchStart/End` highlight offsets | `tests/bun/search.test.ts` snippet test; `<mark>` in Sidebar |
| Jump to matching message | `use-chat.selectConversation(id, msgId)` → `scrollTarget` → MessageList `scrollIntoView` + ring flash |
| Index updates on add/edit/regenerate/delete | lazy `updatedAt`-keyed refresh; edit/regen/delete bump `updatedAt` in store |
| Plan-phase fusion content searchable | message `role:"plan"` indexed like any terminal message |
| In-flight `generating` excluded, terminal included | `STATUS` filter in `index.ts`; `updatedAt` bumped at `chat.done`/`chat.error` persist |
| No syntax; specials literal (`C++`, `[foo]`) | `tests/bun/search.test.ts` literal cases |
| Fully local, no persistence needed | in-memory `SearchIndex` rebuilt from JSON conversations per query |
| Min 3 chars, empty → no results | `query()` early-return + Sidebar `searchMode` gate |
| Debounce + stale-response guard | 250 ms debounce + `seq` ref in Sidebar |

## Gates

- `bun test` — 217 pass / 0 fail (32 files)
- `tsc --noEmit` — clean
- `oxlint` — clean
- `hutch run build` — `build/canary-linux-x64`

## Quickstart trace

1. Type ≥3 chars in sidebar search box → grouped results with highlighted snippets.
2. Click a hit → conversation opens on the matching branch, message scrolled to center, amber ring flash 2 s.
3. `<3` chars falls back to title filter; `Esc` clears.
