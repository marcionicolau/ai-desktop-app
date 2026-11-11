export default {
  electrobun: { version: "2.0.6" },
  scripts: {
    install: ["hutch", "install", "--frozen-lockfile"],
    "build:renderer": [
      "hutch", "pm", "exec", "--",
      "vite", "build", "--config", "src/renderer/vite.config.ts",
    ],
    dev: [
      "sh",
      "-c",
      "hutch pm exec -- vite --config src/renderer/vite.config.ts & vite_pid=$!; VITE_DEV_URL=http://localhost:5173 hutch electrobun dev --watch; status=$?; kill \"$vite_pid\" 2>/dev/null; exit $status",
    ],
    build: ["hutch", "electrobun", "build", "--env=canary"],
    "build:stable": ["hutch", "electrobun", "build", "--env=stable"],
  },
};
