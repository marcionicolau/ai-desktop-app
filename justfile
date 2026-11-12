# ai-desktop-app task runner — `just` lists recipes, `just <recipe>` runs.

default:
    @just --list

# Kill every running app instance (dev/canary/stable launchers, bun main,
# view subprocesses) and the standalone React DevTools electron app.
# Bracket patterns keep pkill from matching this recipe's own cmdline;
# case-sensitive AIDesktopApp avoids matching repo paths (ai-desktop-app).
kill:
    @pkill -f "[A]IDesktopApp" || true
    @pkill -f "[r]eact-devtools" || true

# kill + stop the dev toolchain (vite, esbuild, hutch dev watchers).
# NOTE: the hutch-engine pattern is NOT project-scoped — it also stops
# `hutch dev`/`electrobun dev` sessions running for other projects.
kill-dev: kill
    @pkill -f "{{justfile_directory()}}/[n]ode_modules/" || true
    @pkill -f "[h]utch-engine (dev|electrobun dev|pm exec)" || true

# Clean restart: kill stale processes, launch react-devtools + `bun run
# dev` in background, then watch the app. When the main window closes the
# app exits — the whole stack (devtools, vite, hutch watchers) is torn
# down with it. Ctrl+C hits the same teardown via the EXIT trap.
dev: kill-dev
    #!/usr/bin/env bash
    set -euo pipefail
    trap 'just kill-dev >/dev/null 2>&1' EXIT
    bun run dev:devtools &
    bun run dev &
    dev_pid=$!
    # wait for the app to appear (or bail early if dev dies pre-launch)
    until pgrep -f "[A]IDesktopApp" >/dev/null || ! kill -0 "$dev_pid" 2>/dev/null; do sleep 1; done
    # then hold only on the app — hutch/vite can outlive `bun run dev` itself
    while pgrep -f "[A]IDesktopApp" >/dev/null; do sleep 1; done
