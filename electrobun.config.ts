import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "AI Desktop App",
    identifier: "dev.local.ai-desktop-app",
    version: "0.1.0",
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
} satisfies ElectrobunConfig;
