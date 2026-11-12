import { useSyncExternalStore } from "react";
import { invoke } from "@/lib/rpc";
import type { ThemeMode } from "../../../shared/types";

export type ResolvedTheme = "light" | "dark";

const media = () => window.matchMedia("(prefers-color-scheme: dark)");

let themeMode: ThemeMode = "system";
let resolved: ResolvedTheme = media().matches ? "dark" : "light";
let snapshot: { themeMode: ThemeMode; resolved: ResolvedTheme } = {
  themeMode,
  resolved,
};
const listeners = new Set<() => void>();

function apply(next: ResolvedTheme) {
  if (next === resolved) return;
  resolved = next;
  snapshot = { themeMode, resolved };
  document.documentElement.classList.toggle("dark", next === "dark");
  // transient resolvedTheme → main pushes it to enabled extension views
  void invoke("settings.set", { resolvedTheme: next }).catch(() => {});
  listeners.forEach((l) => l());
}

function resolveNow() {
  apply(
    themeMode === "system" ? (media().matches ? "dark" : "light") : themeMode,
  );
}

media().addEventListener("change", () => {
  if (themeMode === "system") resolveNow();
});

let loaded = false;
function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  void invoke("settings.get", {})
    .then((s) => {
      themeMode = s.themeMode;
      resolveNow();
    })
    .catch(() => {});
  // apply the default immediately so first paint isn't unstyled
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export function setThemeMode(mode: ThemeMode) {
  themeMode = mode;
  void invoke("settings.set", { themeMode: mode }).catch(() => {});
  resolveNow();
  if (snapshot.themeMode !== mode) {
    snapshot = { themeMode, resolved };
    listeners.forEach((l) => l());
  }
}

export function useTheme(): { themeMode: ThemeMode; resolved: ResolvedTheme } {
  ensureLoaded();
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
  );
}
