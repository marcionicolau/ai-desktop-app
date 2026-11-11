import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rendererRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: rendererRoot,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": `${rendererRoot}/src`,
      "@shared": fileURLToPath(new URL("../shared", import.meta.url)),
      // v2: view-side APIs come from the Hutch devkit, not node_modules
      "electrobun/view": fileURLToPath(
        new URL("../../.hutch/devkit/api/browser/index.ts", import.meta.url),
      ),
    },
  },
  build: {
    outDir: fileURLToPath(new URL("../../dist/renderer", import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    // Electrobun dev loads this dev-server URL for HMR.
    port: 5173,
    strictPort: true,
  },
});
