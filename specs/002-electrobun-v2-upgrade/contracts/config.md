# Config Contract: Electrobun 2.x Toolchain

The interface this feature delivers: exactly two config files + a script set
that devs/CI invoke. Field names verified against the v2 docs.

## `hutch.config.ts` (tasks + toolchain pin)

```ts
export default {
  electrobun: { version: "2.0.6" },   // exact pin — MUST equal the version bun resolved
                                      // (node_modules/electrobun/package.json). Bump via
                                      // `hutch electrobun update`
  scripts: {
    install: ["hutch", "install", "--frozen-lockfile"],
    "build:renderer": ["hutch", "pm", "exec", "--", "vite", "build", "--config", "src/renderer/vite.config.ts"],
    // `sh -c` (not a Bun.$ string) so `&` backgrounding works; sets VITE_DEV_URL
    // so src/bun/index.ts loads the Vite dev server for HMR; kills vite on exit.
    dev: [
      "sh", "-c",
      "hutch pm exec -- vite --config src/renderer/vite.config.ts & vite_pid=$!; VITE_DEV_URL=http://localhost:5173 hutch electrobun dev --watch; status=$?; kill \"$vite_pid\" 2>/dev/null; exit $status",
    ],
    build: ["hutch", "electrobun", "build", "--env=canary"],
    "build:stable": ["hutch", "electrobun", "build", "--env=stable"],
  },
};
```

Rules:
- `scripts` is read **only** from `hutch.config.ts` — no npm lifecycle emulation.
- String scripts run via `Bun.$` — no `&`/job control. Concurrent commands must
  use an array script wrapping `sh -c` (or a dedicated TS entrypoint).
- `package.json` scripts kept thin (`bun run typecheck|lint|test|build:renderer`)
  for non-Hutch tooling; `dev`/`build*` delegate to `hutch`.

## `electrobun.config.ts` (app + build)

```ts
import type { ElectrobunConfig } from "electrobun"; // devkit-provided type

export default {
  app: { name: "AI Desktop App", identifier: "dev.local.ai-desktop-app", version: "0.1.0" },
  build: {
    mainProcess: "bun",                    // explicit — REQUIRED
    bun: { entrypoint: "src/bun/index.ts" },
    copy: {
      "dist/renderer": "views/main",       // Vite output → views://main/*
      "native/out": "native",              // per-OS libs → Resources/app/native/*
    },
    useAsar: false,                        // verify v2 field name; dlopen needs real files
  },
  runtime: { exitOnLastWindowClosed: true },
} satisfies ElectrobunConfig;
```

## Import specifiers (code-side contract)

| Side | v1 | v2 |
|------|-----|-----|
| Main process | `from "electrobun"` | `from "electrobun/main"` |
| Webview | `from "electrobun/view"` (unchanged) |

## Generated artifacts (never committed)

- `.hutch/devkit/` — SDK sysroot projected by Hutch prepare (ignored)
- `.hutch/devkit.lock`, `.hutch/locks/` — generated build locks (ignored)
- `~/.hutch/releases/` — shared toolchain cache
- `.hutch/dependencies.lock` — toolchain pin lock (COMMITTED; written by
  `hutch prepare`/`hutch install`, sha256-pins bun + electrobun + cottontail)
- `bun.lock` — npm dependency lock (committed; Bun is the package manager —
  `hutch pm` delegates to it)
