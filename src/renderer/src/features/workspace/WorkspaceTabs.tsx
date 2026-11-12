// feature 019: top-level workspace shell — TabBar + tab contents. Chat is
// the fixed first tab; each enabled pack's declared `tab` view is a peer
// tab hosting a sandboxed BrowserView via ExtViewHost (bare, visible-gated,
// lazy-open per spec A8). Non-selected contents stay mounted (FR-007).
import { useEffect, useState } from "react";
import { TabBar } from "./TabBar";
import { useWorkspaceTabs } from "./use-workspace-tabs";
import { ChatPage } from "../chat/ChatPage";
import { ExtViewHost } from "../extensions/ExtViewHost";

export function WorkspaceTabs() {
  const { tabs, selectedId, select, focusView } = useWorkspaceTabs();
  const [crashed, setCrashed] = useState<Set<string>>(new Set());

  const markCrashed = (id: string) =>
    setCrashed((s) => (s.has(id) ? s : new Set(s).add(id)));

  const clearCrashed = (id: string) =>
    setCrashed((s) => {
      if (!s.has(id)) return s;
      const n = new Set(s);
      n.delete(id);
      return n;
    });

  // drop badges for tabs that vanished — a re-enabled pack starts clean
  useEffect(() => {
    setCrashed((s) => {
      const live = new Set(tabs.map((t) => t.id));
      const kept = [...s].filter((id) => live.has(id));
      return kept.length === s.size ? s : new Set(kept);
    });
  }, [tabs]);

  return (
    <div className="flex h-full flex-col">
      <TabBar tabs={tabs} selectedId={selectedId} crashed={crashed} onSelect={select} />
      <div className="relative min-h-0 flex-1">
        <div hidden={selectedId !== "chat"} className="h-full">
          <ChatPage onOpenTabView={focusView} />
        </div>
        {tabs.map((t) =>
          t.kind === "ext" ? (
            <div key={t.id} hidden={selectedId !== t.id} className="absolute inset-0 flex flex-col bg-background">
              <ExtViewHost
                packId={t.packId}
                viewId={t.viewId}
                slot="tab"
                bare
                visible={selectedId === t.id}
                onCrash={() => markCrashed(t.id)}
                onRecovered={() => clearCrashed(t.id)}
                onClose={() => select("chat")}
              />
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}
