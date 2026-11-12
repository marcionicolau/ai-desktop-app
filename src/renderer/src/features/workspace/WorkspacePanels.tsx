// feature 020/021: workspace panels — the workspace root inside ChatPage's
// column. Every non-surface item is a mounted-hidden full-screen panel:
// chat hosts ALL chat UI, ext `tab` views host a sandboxed BrowserView via
// ExtViewHost (bare, visible-gated, lazy-open per 019 A8), and `pack` items
// host WorkspaceBrowser + RunView. Hidden panels stay mounted so state and
// native view sessions survive switching (FR-007); the sidebar carries the
// tab chrome (crash badge + disable ×).
import type { ReactNode } from "react";
import type { WorkspaceTab } from "@shared/types";
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
  onCrash: (id: string) => void;
  onRecovered: (id: string) => void;
}

export function WorkspacePanels({
  tabs,
  selectedId,
  select,
  focusView,
  chat,
  focusRunId,
  onRunStarted,
  onOpenPanelView,
  onCrash,
  onRecovered,
}: Props) {
  return (
    <>
      {tabs
        .filter((t) => t.kind !== "surface")
        .map((t) => (
          <div
            key={t.id}
            data-testid={`workspace-panel-${t.id}`}
            className={
              t.id === selectedId
                ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                : "hidden"
            }
          >
            {t.kind === "chat" && chat}
            {t.kind === "ext" && (
              <div className="flex min-h-0 flex-1 flex-col">
                <ExtViewHost
                  packId={t.packId}
                  viewId={t.viewId}
                  slot="tab"
                  bare
                  visible={t.id === selectedId}
                  onCrash={() => onCrash(t.id)}
                  onRecovered={() => onRecovered(t.id)}
                  onClose={() => select("chat")}
                />
              </div>
            )}
            {t.kind === "pack" && (
              <div className="min-h-0 flex-1 overflow-y-auto">
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
            )}
          </div>
        ))}
    </>
  );
}
