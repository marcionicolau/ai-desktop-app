# Contract — search.query (feature 007)

One new typed request in `ChatRpcSchema.bun.requests` (see
`src/shared/rpc-contract.ts`):

```ts
"search.query": {
  params: { q: string };
  response: { groups: SearchGroup[] };
};
```

## Behavior

| Case | Result |
|---|---|
| `q` empty, <3 trimmed chars, or whitespace-only | `{groups: []}` |
| term in a message body | group with `hits[]` snippets |
| term in title only | group with `titleMatched: true`, empty `hits` |
| multi-word `q` | message/title must contain ALL terms (AND) |
| `generating`/`failed` messages | never returned |
| >20 matching conversations | first 20 by `updatedAt` desc |
| >3 hits per conversation | earliest 3 matches kept |
| deleted conversation | absent from next query (cache evicts) |

- Case-insensitive literal substring; special chars literal (no regex).
- `hit.snippet` ~80 chars centered on the first term match;
  `matchStart`/`matchEnd` delimit it for highlight rendering.
- Errors: none defined — malformed queries degrade to empty results
  rather than `INVALID_PARAMS` (search is best-effort UX).
