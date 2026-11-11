# Data Model: Tagged Model Roles & Fusion

## `ModelTag` (persisted in `settings.json: tags[]`)

```ts
interface ModelTag {
  name: string;            // unique, /^[a-z0-9]+(-[a-z0-9]+)*$/, 1-32 chars
  label?: string;          // display name; defaults to name
  description?: string;    // purpose note ("planning model")
  binding: string | null;  // bound file basename; null = unbound
  params: Partial<GenerationParams>; // per-tag overrides (FR-003)
  fallback: RoleRef[];     // ordered chain, max 3, cycle-checked (FR-009)
}

type RoleRef = { kind: "tag"; name: string } | { kind: "model"; fileName: string };
```

**Derived state** (`RoleState`, computed at resolve/list time — never stored):

```ts
type RoleState = "bound" | "unbound" | "broken"; // broken = fileName not in library
```

## `ResolvedRole` (runtime, produced by `RoleResolver`)

```ts
interface ResolvedRole {
  tag: string;
  fileName: string;
  path: string;            // absolute
  params: GenerationParams; // merged: DEFAULT < global < file < tag
  servedBy: { kind: "primary" } | { kind: "fallback"; via: RoleRef };
}
```

## `Conversation` (extended)

```ts
mode: "single" | "fusion";          // default "single"
plannerTag: string;                  // default "planner"
executorTag: string;                 // default "executor"
```

## `Message` (extended)

```ts
phases?: {
  plan?: { content: string; stats?: MessageStats | null; tag: string; fileName: string };
  answer?: { stats?: MessageStats | null; tag?: string; fileName?: string };
} | null; // absent on pre-004 and single-mode messages
```

`content` stays the answer text — `phases.plan.content` carries the plan
artifact; renderer collapses it. Plan is *not* re-sent through chat
history as an assistant turn (it's injected by `buildExecutorPrompt`).

## `ModelRegistry` slot (runtime only)

```ts
interface ModelSlot {
  model: number;      // lls_model* handle
  ctx: number;        // lls_ctx* handle
  fileName: string;
  busyFor: string | null;   // conversationId while a turn is in flight
  stale: boolean;         // rebound mid-flight — free on release
  lastUsedAt: number;
}
```

`MAX_SLOTS = 2`; acquire beyond capacity evicts the LRU
`!busyFor && !generating` slot.

## `Settings` (extended)

```ts
tags: ModelTag[];   // provisioned ["default", "planner", "executor"] on first run —
  // "default" bound to activeModelPath; the other two unbound
```

`activeModelPath` remains the *single-mode* model and is kept in sync with
the built-in `default` tag's `binding`: `model.load(path)` rebinds
`default` to that file, and `role.bind("default", file)` updates
`activeModelPath`. Single-mode generation resolves through
`resolve("default")`, so every entry point is tag-referenced (FR-010).

## Validation rules

- `name`: slug regex, unique, `INVALID_PARAMS` / `ALREADY_EXISTS` on violation
- `binding`: must exist in library → else `MODEL_NOT_FOUND`; missing file
  on disk at list-time ⇒ `broken` state (not an error at bind-time if the
  file later disappears — state is derived)
- `fallback`: ≤3 entries, no self-ref, no cycles, `INVALID_PARAMS`
- `role.delete`: `ROLE_IN_USE` when the tag is a conversation's active
  planner/executor or another tag's fallback entry, unless `{force}` detaches
  (clears those refs)
