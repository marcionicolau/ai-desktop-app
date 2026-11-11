# Data Model — 010-kv-state-persistence

## Manifest — `$data/kv/index.json`

```jsonc
{
  "entries": [
    {
      "key": "<convId>/<roleKey>",       // roleKey: "main"|"planner"|"executor"
      "convId": "c-…",
      "roleKey": "main",
      "modelPath": "/…/qwen.gguf",
      "fingerprint": "path|size|sha256(head64K+tail64K)",
      "ctxSize": 4096,                    // n_ctx at save; mismatch → discard
      "file": "c-…_main.kv",
      "sizeBytes": 872415232,
      "updatedAt": "2026-01-05T…"          // drives LRU
    }
  ]
}
```

## Settings addition

```ts
settings.snapshot?: { enabled: boolean; maxBytes: number }
// default {enabled: true, maxBytes: 2_147_483_648}  (2 GiB)
// undefined → enabled (feature on by default; opt-out, not opt-in)
```

## Shared types

```ts
export interface SnapshotPolicy { enabled: boolean; maxBytes: number }
export interface SnapshotStats  { count: number; usedBytes: number; maxBytes: number }
export interface SnapshotClearResult { removed: number; freedBytes: number }
```

## Invariants

- ≤1 entry per `convId/roleKey` (spec assumption).
- Manifest is the only truth; a `.kv` blob without an entry is an
  orphan (swept). Entry without blob → treated as missing.
- Write order: blob → `.tmp` → fsync-ish rename → manifest rewrite →
  LRU enforce. A crash anywhere leaves either no entry or a torn `.tmp`.
