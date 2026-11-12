import type { ElectrobunConfig } from "electrobun";
import { computeVersion } from "./scripts/version";

export default {
  app: {
    name: "Causerie",
    identifier: "dev.local.ai-desktop-app",
    // semver derived from git (scripts/version.ts) — no manual bumps
    version: computeVersion(),
  },
  build: {
    mainProcess: "bun",
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    // Renderer is built by Vite (Tailwind v4/shadcn pipeline) into dist/renderer,
    // then copied into the bundle's views directory. Native per-OS libs are
    // staged into app resources; dlopen needs real files (no ASAR).
    copy: {
      "dist/renderer": "views/main",
      "native/out": "native",
    },
    // Per-OS sections: complete config for all three platforms; only the
    // Linux lane is verified today (feature 012). Electrobun builds on-host
    // — each section activates when a build runs on that OS.
    mac: {
      codesign: false, // flip with a Developer ID identity (see docs/packaging.md)
      notarize: false, // requires codesign
      createDmg: true,
      defaultRenderer: "native",
    },
    win: {
      autoGrantPermissions: [],
      defaultRenderer: "native",
    },
    linux: {
      defaultRenderer: "native",
    },
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  // feature 013: update feed — manifests + artifacts published to the
  // rolling `feed` GitHub Release by packaging.yml. UPDATE_FEED_BASE_URL
  // overrides for test/alternate hosts (loopback http is legal locally).
  release: {
    baseUrl:
      process.env.UPDATE_FEED_BASE_URL ??
      "https://github.com/marcionicolau/causerie/releases/download/feed",
  },
} satisfies ElectrobunConfig;
