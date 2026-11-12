# Quickstart: Startup Model Selection

## Prerequisites

- Repo deps installed (`bun install`); this feature touches renderer +
  reducer-level state only.

## Validation scenarios

**S1 — Fresh install (P1)**: clear `APP_DATA_DIR` (or point it at an empty
dir). `bun run dev`. Expect: app boots → model library opens automatically
(no click). Pick or download a `.gguf` → model loads → chat works →
`activeModelPath` saved → relaunch → **no** prompt, model loads.

**S2 — Configured model (FR-003)**: with a valid `activeModelPath`, launch
→ prompt never appears → status goes `loading → ready`.

**S3 — Empty library (P2/FR-005)**: `MODELS_DIR` to an empty dir + no
`activeModelPath` → prompt opens into the library showing the download
form, not an empty list.

**S4 — Dismissal (FR-004)**: from S1, close the library without loading →
banner remains → prompt does not reopen this session → manual library
button still works.

**S5 — Missing default file (FR-007)**: `activeModelPath` pointing at a
deleted file → startup shows error + prompt opens.

**S6 — Loading guard (FR-006)**: with a valid `activeModelPath`, observe
no prompt flash during `loading`.

## Gates

- `bun test ./tests`, `bun run typecheck`, `bun run lint`,
  `bun run build:renderer` — all green.
