// feature 026 (FR-016): interface density — "comfortable" (default) or
// "compact". Mirrors lib/theme.ts: applied as data-density on <html> (the
// token sets live in index.css), persisted through settings.set, with a
// localStorage mirror so first paint already has the right spacing.
import { useSyncExternalStore } from "react";
import { invoke } from "@/lib/rpc";
import type { Density } from "../../../shared/types";
import { isDensity, nextDensity } from "./density-core";

export { DENSITIES, isDensity, nextDensity } from "./density-core";

const MIRROR_KEY = "causerie.density";

function readMirror(): Density {
  try {
    const v = localStorage.getItem(MIRROR_KEY);
    return isDensity(v) ? v : "comfortable";
  } catch {
    return "comfortable";
  }
}

function writeMirror(d: Density) {
  try {
    localStorage.setItem(MIRROR_KEY, d);
  } catch {
    /* convenience only */
  }
}

let density: Density = readMirror();
const listeners = new Set<() => void>();

function apply(d: Density) {
  document.documentElement.dataset.density = d;
}
apply(density);

function commit(d: Density) {
  if (d === density) return;
  density = d;
  apply(d);
  writeMirror(d);
  listeners.forEach((l) => l());
}

export function setDensity(d: Density) {
  commit(d);
  void invoke("settings.set", { density: d }).catch(() => {});
}

export const toggleDensity = () => setDensity(nextDensity(density));

let loaded = false;
function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  void invoke("settings.get", {})
    .then((s) => commit(isDensity(s.density) ? s.density : "comfortable"))
    .catch(() => {});
}

export function useDensity(): Density {
  ensureLoaded();
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => density,
  );
}
