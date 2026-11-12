// feature 019: pure workspace tab model — no RPC/browser deps so it stays
// headless-testable. The hook (use-workspace-tabs.ts) wires this to
// extension.scan + extension.changed.
import type { InstalledPackView, WorkspaceTab } from "@shared/types";

export const CHAT_TAB: WorkspaceTab = { kind: "chat", id: "chat", title: "Chat" };

export interface TabState {
  tabs: WorkspaceTab[];
  selectedId: string;
}

export function deriveTabs(packs: InstalledPackView[]): WorkspaceTab[] {
  const tabs: WorkspaceTab[] = [CHAT_TAB];
  for (const p of packs) {
    if (p.state !== "enabled") continue;
    for (const v of p.manifest.contributions.views ?? []) {
      if (v.slot !== "tab") continue;
      tabs.push({
        kind: "ext",
        id: `${p.id}:${v.id}`,
        packId: p.id,
        viewId: v.id,
        title: v.title || v.id || p.id,
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
