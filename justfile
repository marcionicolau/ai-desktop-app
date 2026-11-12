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
