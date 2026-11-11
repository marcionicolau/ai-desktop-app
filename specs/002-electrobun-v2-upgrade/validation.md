# Validation Report — Electrobun v2 Upgrade

Date: 2025-11-11. Host: linux-x64, X11 display available. Tasks T010–T020.

## VS-1 — Dev mode (US1, SC-001) — PASS

- `bun run dev` → `hutch dev` resolves `scripts.dev`: vite dev-server on :5173
  (strictPort) + `hutch electrobun dev --watch`.
- Dev bundle emitted to `build/dev-linux-x64/`; launcher spawned the app;
  GTK event loop + X11 window opened in ~10s total (vite ready in 422 ms).
- HMR verified: edit to `ChatPage.tsx` → `[vite] (client) hmr update` in log;
  probe reverted.
- `.hutch/devkit` exists; `tsc --noEmit` resolves `electrobun/*` via devkit
  `paths` — no hand-written shim.

## VS-2 — Packaged build (US2, SC-003) — PASS (linux-x64)

- `bun run build` → `hutch run build` → `electrobun build --env=canary` →
  `build/canary-linux-x64/AIDesktopApp-canary/` (~66 MB).
- Bundle: `Resources/app/views/main/` = Vite output;
  `Resources/app/native/linux-x64/` = `libllama_shim.so` + libllama/libggml.
- `./bin/launcher` → self-extracts + installs to
  `~/.local/share/dev.local.ai-desktop-app/canary/app` (desktop shortcut +
  uninstaller created) → launched → window opened; bundled `main.js` runs.
- App resources ship as real files (no ASAR) — `dlopen` works.

## VS-3 — No stale tooling (US3, SC-004) — PASS

- Root holds exactly `electrobun.config.ts` + `hutch.config.ts`.
- No `types/electrobun.d.ts`; no `from "electrobun"` code imports (only
  `electrobun/main`/`view` specifiers + `import type` in config).
- `commit_style` note: spec docs' references to the old shim are historical
  context within the migration docs themselves — intentional.

## VS-4 — Gates (SC-005) — PASS

- `tsc --noEmit` 0 errors; `oxlint` 0 errors (4 warnings);
  `bun test ./tests` 32/32; `vite build` 326 kB JS / 14 kB CSS.

## Command surface (verified)

| Command | Path | Result |
|---------|------|--------|
| `bun run dev` | `hutch dev` → `scripts.dev` (sh -c: vite + `hutch electrobun dev --watch`) | PASS |
| `bun run build` | `hutch run build` → `hutch electrobun build --env=canary` | PASS |
| `bun run build:stable` | `hutch run build:stable` (same path, stable env) | script verified, build not run |
| `bun x electrobun prepare` | devkit projection | PASS |
| gates | typecheck/lint/test/build:renderer | PASS |

**Not verified**: `hutch install` — Hutch's built-in resolver ignores
`bun.lock` and never runs lifecycle scripts; Bun is the project's package
manager (`bun install` used throughout). `hutch build` bare is a Hutch
built-in (forwards to `bun build`), NOT `scripts.build` — use `hutch run
build`. Windows/macOS packaging not exercised (no hosts).

## Checklist status

`checklists/migration.md`: 29/29 unchecked — reviewer-owned, by design.
