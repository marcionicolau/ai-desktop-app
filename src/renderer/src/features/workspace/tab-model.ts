// feature 019: pure workspace tab model — no RPC/browser deps so it stays
// headless-testable. The hook (use-workspace-tabs.ts) wires this to
// extension.scan + extension.changed.
import type { InstalledPackView, WorkspaceTab } from "@shared/types";

export const CHAT_TAB: WorkspaceTab = { kind: "chat", id: "chat", title: "Chat" };

// feature 021: app surfaces are workspace items — each alone on screen.
// Extensions surface hosts the manage/browse/runs panels; ids are stable
// so sidebar nav and accordion selection share the same addressing.
export const SURFACE_TABS: WorkspaceTab[] = [
  { kind: "surface", id: "surface:models", surfaceId: "models", title: "Models" },
  { kind: "surface", id: "surface:personas", surfaceId: "personas", title: "Personas" },
  { kind: "surface", id: "surface:roles", surfaceId: "roles", title: "Roles" },
  { kind: "surface", id: "surface:scripts", surfaceId: "scripts", title: "Scripts" },
  { kind: "surface", id: "surface:settings", surfaceId: "settings", title: "Settings" },
  { kind: "surface", id: "surface:extensions", surfaceId: "extensions", title: "Extensions" },
];

export interface TabState {
  tabs: WorkspaceTab[];
  selectedId: string;
}

export function deriveTabs(packs: InstalledPackView[]): WorkspaceTab[] {
  const tabs: WorkspaceTab[] = [CHAT_TAB, ...SURFACE_TABS];
  for (const p of packs) {
    if (p.state !== "enabled") continue;
    const tabViews = (p.manifest.contributions.views ?? []).filter(
      (v) => v.slot === "tab",
    );
    for (const v of tabViews) {
      tabs.push({
        kind: "ext",
        id: `${p.id}:${v.id}`,
        packId: p.id,
        viewId: v.id,
        title: v.title || v.id || p.id,
        packName: p.manifest.name || p.id,
      });
    }
    // every enabled pack gets a tab: packs without declared `tab` views
    // host their workspace browser in a pack tab (user decision 2026-11-12)
    if (tabViews.length === 0) {
      tabs.push({
        kind: "pack",
        id: p.id,
        packId: p.id,
        title: p.manifest.name || p.id,
        packName: p.manifest.name || p.id,
      });
    }
  }
  return tabs;
}

// Re-derives tabs after a pack change. Newly appearing ext tabs auto-select
// (enable transition, FR-005); a vanished selection falls back to chat
// (FR-010). Startup callers seed `prev` from the initial derive so restored
// tabs are never treated as "new" (FR-006).
export function reconcile(prev: TabState, packs: InstalledPackView[]): TabState {
  const tabs = deriveTabs(packs);
  const known = new Set(prev.tabs.map((t) => t.id));
  const fresh = tabs.find((t) => t.kind === "ext" && !known.has(t.id));
  const stillThere = tabs.some((t) => t.id === prev.selectedId);
  return {
    tabs,
    selectedId: fresh?.id ?? (stillThere ? prev.selectedId : "chat"),
  };
}
