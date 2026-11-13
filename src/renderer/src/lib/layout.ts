// feature 026 (FR-025, FR-026): remembered panel sizes, per window.
// Stored in browser storage as a per-viewer convenience: every access is
// guarded, values are validated and clamped on read, and nothing here may
// throw — a broken or blocked store just means defaults.

export const LAYOUT_PREFIX = "causerie.layout.";

// the sidebar is sized in pixels; its limits keep the icon-rail collapse and
// every sidebar control usable down to 800 × 600
export interface SizeSpec {
  key: string;
  min: number;
  max: number;
  default: number;
}

export const SIDEBAR_WIDTH: SizeSpec = { key: "sidebar-width", min: 208, max: 480, default: 256 };

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export const clampSize = (v: number, spec: SizeSpec): number =>
  Math.min(spec.max, Math.max(spec.min, Math.round(v)));

export function readSize(spec: SizeSpec, storage: StorageLike | null = safeStorage()): number {
  try {
    const raw = storage?.getItem(LAYOUT_PREFIX + spec.key);
    const n = raw === null || raw === undefined ? NaN : Number(raw);
    return Number.isFinite(n) ? clampSize(n, spec) : spec.default;
  } catch {
    return spec.default;
  }
}

export function writeSize(
  spec: SizeSpec,
  value: number,
  storage: StorageLike | null = safeStorage(),
): void {
  try {
    storage?.setItem(LAYOUT_PREFIX + spec.key, String(clampSize(value, spec)));
  } catch {
    /* convenience only */
  }
}

// ---- percentage layouts of a panel group ({ panelId: percent }) -----------

export type PanelLayout = Record<string, number>;

export function readLayout(
  id: string,
  panelIds: string[],
  storage: StorageLike | null = safeStorage(),
): PanelLayout | undefined {
  try {
    const raw = storage?.getItem(LAYOUT_PREFIX + id);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const out: PanelLayout = {};
    for (const pid of panelIds) {
      const v = (parsed as Record<string, unknown>)[pid];
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) return undefined;
      out[pid] = v;
    }
    // a stored layout must still describe a whole group
    const sum = Object.values(out).reduce((a, b) => a + b, 0);
    return Math.abs(sum - 100) <= 1 ? out : undefined;
  } catch {
    return undefined;
  }
}

export function writeLayout(
  id: string,
  layout: PanelLayout,
  storage: StorageLike | null = safeStorage(),
): void {
  try {
    storage?.setItem(LAYOUT_PREFIX + id, JSON.stringify(layout));
  } catch {
    /* convenience only */
  }
}

// ---- reset ----------------------------------------------------------------

const RESET_EVENT = "causerie:layout-reset";

// removes every remembered size and tells mounted panels to return to defaults
export function resetLayout(storage: StorageLike | null = safeStorage()): void {
  try {
    const s = storage as Storage | null;
    if (s && typeof s.length === "number") {
      for (let i = s.length - 1; i >= 0; i--) {
        const k = s.key(i);
        if (k?.startsWith(LAYOUT_PREFIX)) s.removeItem(k);
      }
    }
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(RESET_EVENT));
}

export function onLayoutReset(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(RESET_EVENT, cb);
  return () => window.removeEventListener(RESET_EVENT, cb);
}
