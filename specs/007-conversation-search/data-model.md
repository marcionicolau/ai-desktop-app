# Data Model — 007-conversation-search

## Index entry (memory only, derived)

```ts
interface SearchIndexEntry {
  conversationId: string;
  messageId: string;
  role: "user" | "assistant";
  timestamp: string;            // message.createdAt (ISO)
  searchableText: string;       // lowercased content + plan content
  snippetSource: string;        // original-case text for snippet extraction
}
```

- Built from `Conversation.messages[]` where `status` is `complete` or
  `partial` — `generating`/`failed` excluded (FR-009).
- `searchableText` includes `phases.plan.content` for fusion messages
  (FR-007) and every variant in the flat `messages[]` (FR-006).

## Search group (RPC response, shared type)

```ts
interface SearchHit {
  messageId: string;
  role: "user" | "assistant";
  timestamp: string;
  snippet: string;      // ~80 chars of context around the first match
  matchStart: number;   // byte range of the first match within snippet
  matchEnd: number;
}

interface SearchGroup {
  conversationId: string;
  title: string;
  updatedAt: string;    // group ordering key (desc)
  personaName?: string | null;
  titleMatched: boolean;
  hits: SearchHit[];    // ≤3 per group, earliest message first
}

interface SearchResponse { groups: SearchGroup[] }  // ≤20 groups
```

## Cache (service state)

```ts
Map<conversationId, { updatedAt: string; title: string; entries: SearchIndexEntry[] }>
```

- Keyed invalidation on `updatedAt` — no persistence, no invalidation
  hooks (research D1).

## Validation rules

- Query: trimmed, ≥3 chars, whitespace-split into terms (AND semantics).
- Empty/short query → `{groups: []}` without touching the index.
- Terms matched literally after lowercasing — no regex (research D6).
