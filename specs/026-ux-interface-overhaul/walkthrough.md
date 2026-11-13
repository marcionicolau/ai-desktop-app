# Scripted Walkthrough (SC-002, SC-003, SC-004)

Run once on current `main` before any visual change merges (baseline, T002) and again at the end (T065). Use the same machine, window size (1024 × 720), theme (system default), model (`SmolLM2-135M-Instruct-Q4_K_M.gguf`) and a fresh `APP_DATA_DIR`. Time each task with a stopwatch from the stated start state to the stated end state. A task **passes** only if every checklist line is true on the first attempt without documentation.

| # | Task | Start state | End state | Checklist |
|---|------|-------------|-----------|-----------|
| 1 | Start a chat | App open, a model loaded, no conversation selected | A reply has finished streaming | ☐ New chat reachable without hunting ☐ Send gives immediate busy feedback ☐ Completion is clear |
| 2 | Switch model | Chat open with model A loaded | Model B loaded and shown as active | ☐ Switch control found ≤ 2 clicks/keys ☐ Progress shown while loading ☐ Result confirmed |
| 3 | Change a generation setting | Chat open | Temperature changed and saved | ☐ Setting found without a guide ☐ Range/unit visible ☐ Saved state obvious |
| 4 | Import a file | Conversations list visible, an exported envelope on disk | Imported conversation selected | ☐ Import control found ☐ Progress/result shown ☐ Errors (if any) recoverable |
| 5 | Delete a conversation | At least 2 conversations | One removed | ☐ Delete control found ☐ Confirmation names the item ☐ List updates |
| 6 | Reach a named item (SC-003) | Any screen | Open, in order: a named conversation, a named model, a named setting | ☐ Each reached ☐ Keystrokes/clicks counted per item |

## Recording template (copy into `validation.md`)

| # | Date | Build (baseline / final) | Time (s) | Keystrokes + clicks | Pass | Notes |
|---|------|--------------------------|----------|---------------------|------|-------|
| 1 | | | | | | |

## Pass bar

- Final run: every task passes, and no task is slower than its baseline time (clarification 3).
- Task 6: median time under 5 s and under 3 keystrokes once the command palette is open (SC-003).
