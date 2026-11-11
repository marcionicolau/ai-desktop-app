# Quickstart — 011-model-advisor

## VS-1 Benchmark a model

1. Open the model library; a row with no data shows "not measured" and
   a ▶ benchmark button.
2. Click ▶ → the button spins while a bounded run executes (≤ ~30 s).
3. Row now shows tok/s + memory; restart the app — figures persist
   with a "measured" marker.

## VS-2 Fit verdicts

4. Every row shows a badge: fits / tight / won't fit, plus a
   recommended max context (e.g. "ctx ≤ 8192").
5. Badge basis is labeled: `measured` after a benchmark, `est.` before.
6. Free memory changes → reopen the panel; verdicts recompute live.

## VS-3 Fusion combined fit

7. Bind planner + executor to different models → the fusion controls
   show a combined-fit line: sequential peak and combined residency.
8. A known-too-big pair reports `won't fit` instead of looking safe.

## Error paths

9. Benchmark during a generation → `BUSY` toast, no interference.
10. Benchmark a deleted/unreadable path → `MODEL_NOT_FOUND`.
