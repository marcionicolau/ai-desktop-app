// feature 019: workspace tab host — lives inside ChatPage's column (the tab
// system is owned by the chat workspace, not the app root). `chat` is the
// chat tab's content (MessageList..Composer); each enabled pack's declared
// `tab` view is a peer tab hosting a sandboxed BrowserView via ExtViewHost
// (bare, visible-gated, lazy-open per spec A8), and every enabled pack
// without `tab` views gets a `pack` tab hosting its WorkspaceBrowser +
// RunView. Non-selected contents stay mounted (FR-007). × on a tab
// disables the owning pack (extension.changed reconciles).
import { useEffect, useState, type ReactNode } from "react";
import type { WorkspaceTab } from "@shared/types";
import { TabBar } from "./TabBar";
import { ExtViewHost } from "../extensions/ExtViewHost";
import { WorkspaceBrowser } from "../extensions/WorkspaceBrowser";
import { RunView } from "../extensions/RunView";

interface Props {
  tabs: WorkspaceTab[];
  selectedId: string;
  select: (id: string) => void;
  focusView: (packId: string, viewId: string) => void;
  chat: ReactNode;
  focusRunId: string | null;
  onRunStarted: (runId: string) => void;
  onOpenPanelView: (packId: string, viewId: string) => void;
  onCloseTab: (packId: string) => void;
}

export function WorkspaceTabs({
  tabs,
  selectedId,
  select,
  focusView,
  chat,
  focusRunId,
  onRunStarted,
  onOpenPanelView,
  onCloseTab,
}: Props) {
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
    <>
      <TabBar
        tabs={tabs}
        selectedId={selectedId}
        crashed={crashed}
        onSelect={select}
        onCloseTab={onCloseTab}
      />
      <div className="relative min-h-0 flex-1">
        <div hidden={selectedId !== "chat"} className="absolute inset-0 flex flex-col">
          {chat}
        </div>
        {tabs.map((t) => {
          if (t.kind === "ext") {
            return (
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
            );
          }
          if (t.kind === "pack") {
            return (
              <div key={t.id} hidden={selectedId !== t.id} className="absolute inset-0 overflow-y-auto bg-background">
                <WorkspaceBrowser
                  packId={t.packId}
                  onRunStarted={onRunStarted}
                  onOpenView={(packId, viewId, slot) =>
                    slot === "tab"
                      ? focusView(packId, viewId)
                      : onOpenPanelView(packId, viewId)
                  }
                />
                <RunView focusRunId={focusRunId} />
              </div>
            );
          }
          return null;
        })}
      </div>
    </>
  );
}
