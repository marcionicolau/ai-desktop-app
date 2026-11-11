# Quickstart: Chat Quality & Model Management — Validation Guide

## Prerequisites

Same as feature-001/002 + `bun install` for the new renderer deps
(`react-markdown`, `remark-gfm`, `rehype-highlight`). A GGUF model in
`models/` (SmolLM2-135M suffices; a second small GGUF helps US4 tests).

## Validation scenarios

### VS-1 — Sampling control (US1, SC-001; FR-001, FR-002, FR-003)

1. `bun run dev` → Settings panel → set `temperature: 0.9`, send the same
   prompt twice → outputs differ.
2. Set `seed: 42` + `temperature: 0` → same prompt twice → identical output.
3. Set `maxTokens: 32` → reply stops mid-thought, marked complete (not failed).

### VS-2 — Warm-turn latency (US2, SC-002; FR-004, FR-005)

1. In one conversation send 3+ messages; verify via the engine's `warm`
   flag (test or log) that turns ≥2 reuse the KV prefix and decode only the
   divergent suffix. Absolute speed-up depends on model size.
2. Trigger truncation (long history) or switch conversations → next turn
   transparently falls back to a full decode (no corrupted output).

### VS-3 — Rich chat surface (US3, SC-003; FR-006, FR-007, FR-008, FR-009)

1. Ask "write a hello world in C" → reply renders markdown + highlighted
   code block; hover actions show copy → clipboard gets raw text.
2. Click regenerate on the last reply → same bubble streams a new variant.
3. Edit a prior user message → later turns vanish, new reply streams.
4. Type in the sidebar filter → conversation list narrows live.
5. Stats under a finished reply show `N tokens · X tok/s`.

### VS-4 — Model library & download (US4, SC-004; FR-010, FR-011, FR-012)

1. Open the model panel → local `.gguf` files listed with arch/params/quant.
2. Paste `https://huggingface.co/.../resolve/.../file.gguf` → progress
   event advances → file lands in `models/` and can be loaded.
3. Kill mid-download → `.part` file is removed; library excludes it.
4. Set a per-model override (e.g. `maxTokens: 64`) → applies on next load.

### VS-5 — Gates (SC-005; FR-013)

- `bun run typecheck`, `bun run lint`, `bun test ./tests`,
  `bun run build:renderer`, `bash scripts/build-native.sh` all pass.
