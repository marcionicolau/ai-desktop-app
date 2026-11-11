# Data Model: Chat Quality & Model Management

## New / Extended Entities

### `GenerationParams` (new)

```ts
interface GenerationParams {
  temperature: number;   // 0.0–2.0; 0 = greedy
  topP: number;          // 0.0–1.0 nucleus cutoff; 1 = off
  topK: number;          // ≥0; 0 = off
  repeatPenalty: number; // ≥0; 1.0 = off
  seed: number;          // uint32; 0 = random each run
  maxTokens: number;     // ≥0; 0 = ctx-bound only
  nThreads: number;      // ≥0; 0 = llama default
  nGpuLayers: number;    // ≥0; 0 = CPU only
}
```

- Defaults: `{0, 1, 0, 1, 0, 512, 0, 0}` (current behavior: greedy + 512 cap)
- Persisted in `settings.json` under `generation`; per-model overrides under
  `modelOverrides[basename]` as `Partial<GenerationParams>`

### `ModelMeta` (new)

```ts
interface ModelMeta {
  path: string;          // absolute path to .gguf
  fileName: string;      // basename — the override key
  sizeBytes: number;
  name: string | null;        // general.name
  architecture: string | null; // general.architecture
  paramCount: string | null;   // e.g. "135M" (formatted)
  quantization: string | null; // file type name e.g. "Q4_K_M"
  contextTrain: number | null; // trained ctx length
}
```

Derived per file via `lls_gguf_meta` — never persisted (recomputed on scan).
Any field is `null` when the GGUF header omits the key or the header fails to
parse; `null` fields render as unknown in the library.

### KV reuse state (new, runtime only — inside the shim)

```c
// fields on lls_ctx — a mirror of every token currently in KV (seq 0)
llama_token * kv_tokens; // prompt + sampled tokens, capacity = n_ctx
int32_t       kv_count;  // valid entries
```

`lls_generate_continue` tokenizes the incoming full prompt, computes the
longest common token prefix against the mirror, trims KV past it via
`llama_memory_seq_rm`, decodes only the suffix, and returns `0` (reused) or
`2` (no shared prefix — full decode). JS passes `conversationId` only as a
reuse hint; the token comparison makes divergence impossible.

- Lives only in `engine.ts`; invalidated by conv switch, model unload,
  truncation, regenerate/edit, restart.

### `DownloadState` (new)

```ts
interface DownloadState {
  fileName: string;
  phase: "progress" | "done" | "error";
  downloadedBytes: number;
  totalBytes: number | null;
  error?: string;
}
```

Carried by the `model.download` event while a fetch is active.

### `Message` (extended)

```ts
stats?: { tokens: number; tokensPerSec: number } | null;
  // present on complete AND partial turns when tokens > 0;
  // null on failed turns or zero-token generations
```

Optional, persisted with the assistant turn on `chat.done`.

## `Settings` (extended)

```ts
interface Settings {
  activeModelPath: string | null;      // existing
  generation: GenerationParams;        // new
  modelOverrides: Record<string, Partial<GenerationParams>>; // new
}
```

## State Transitions

- **Regenerate**: assistant msg (last turn, `complete|partial`) →
  `generating` in place → `complete|partial|failed` (same messageId, new
  content + stats).
- **Edit+resend**: user msg content replaced → all later turns deleted →
  new assistant `generating` appended.
- **Download**: `progress…` → `done` (file renamed, loadable) | `error`
  (`.part` removed).
