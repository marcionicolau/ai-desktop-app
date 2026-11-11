export default {
  electrobun: { version: "2.0.6" },
  scripts: {
    install: ["hutch", "install", "--frozen-lockfile"],
    "build:renderer": [
      "hutch", "pm", "exec", "--",
      "vite", "build", "--config", "src/renderer/vite.config.ts",
    ],
    dev: "hutch pm exec -- vite --config src/renderer/vite.config.ts & hutch electrobun dev --watch",
    build: ["hutch", "electrobun", "build", "--env=canary"],
    "build:stable": ["hutch", "electrobun", "build", "--env=stable"],
  },
};
