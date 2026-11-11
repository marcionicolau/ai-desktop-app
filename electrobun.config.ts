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
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
} satisfies ElectrobunConfig;
