// Data directory resolution. In the Electrobun main process this is
// Utils.paths.userData; outside it (tests, scripts) falls back to ~/.ai-desktop-app.
import { homedir } from "node:os";
import { join } from "node:path";

let cached: string | null = null;

export function dataDir(): string {
  // env override is read live (tests set it per-file); only the
  // Electrobun/fallback resolution is cached
  if (process.env.APP_DATA_DIR) return process.env.APP_DATA_DIR;
  if (cached !== null) return cached;
  try {
    // resolved lazily so this module stays importable outside Electrobun
    const { Utils } = require("electrobun/main") as typeof import("electrobun/main");
    cached = Utils.paths.userData;
  } catch {
    cached = join(homedir(), ".ai-desktop-app");
  }
  return cached;
}

export function conversationsDir(): string {
  return join(dataDir(), "conversations");
}

export function settingsFile(): string {
  return join(dataDir(), "settings.json");
}
