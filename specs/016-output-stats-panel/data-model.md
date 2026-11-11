# Data Model — 016-output-stats-panel

## MetricEntry (shared type, in-memory only)

```ts
export interface MetricEntry {
  id: string;              // crypto-random
  ts: string;              // ISO, call completion time
  conversationId: string;
  modelFile: string;       // serving model basename (FR-004 fallback-aware)
  roleKey: string;         // "main" | "planner" | "executor"
  tag?: string;            // resolved role tag, if any
  personaName?: string;    // captured at call time
  promptTokens: number;    // lls_token_count of the built prompt
  outputTokens: number;    // generated tokens
  elapsedMs: number;
  warm: boolean;           // KV prefix/state reuse hit
  status: "complete" | "partial" | "failed";
  fallback?: boolean;      // served by fallback chain, not bound model
  promptPreview: string;   // ≤120 chars, single line
}
```

## Settings addition

```ts
settings.outputPanel?: boolean // default false — off until toggled
```

## Invariants

- ≤500 entries, oldest dropped (session-scoped, nothing persisted).
- One entry per engine call: fusion turns produce 2 (planner+executor);
  a failed candidate produces a `failed` entry for the model tried.
- `promptPreview` derives from the request text (`current`), same value
  for all phases of a turn.
