# Window size floor

The app is designed and tested down to **800 × 600** (feature 026,
FR-015). Below that width layouts must degrade without breaking — the
sidebar auto-collapses to its icon rail (AppSidebar `matchMedia`
breakpoint at 896 px), the chat header wraps, and no horizontal page
scroll is allowed.

Electrobun 2.x `BrowserWindow` exposes only `frame: {x, y, width,
height}` — there is **no minimum-size option** (verified against
`.hutch/devkit/api/sdks/main/core/BrowserWindow.ts`, research.md R7).
800 × 600 is therefore a tested design floor, not an enforced limit:
the window can be shrunk smaller and the layout is expected to keep
degrading gracefully.
