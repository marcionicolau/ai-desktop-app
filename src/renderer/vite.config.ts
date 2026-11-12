import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rendererRoot = fileURLToPath(new URL(".", import.meta.url));

// dev-only: inject the react-devtools standalone backend at parse time —
// it must install __REACT_DEVTOOLS_GLOBAL_HOOK__ before react-dom
// evaluates, which module imports make impossible from main.tsx
const reactDevtools = () => ({
  name: "react-devtools-inject",
  apply: "serve" as const,
  transformIndexHtml: (html: string) =>
    html.replace(
      "<head>",
      '<head>\n    <script src="http://localhost:8097"></script>',
    ),
});

export default defineConfig({
  root: rendererRoot,
  plugins: [reactDevtools(), react(), tailwindcss()],
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
