// feature 020: workspace accordion — the workspace root inside ChatPage's
// column. Chat is the first item (never closable) hosting ALL chat UI
// (fusion controls, notices, MessageList..Composer); each enabled pack's
// declared
// `tab` view is a peer item hosting a sandboxed BrowserView via ExtViewHost
// (bare, visible-gated, lazy-open per 019 A8), and every enabled pack
// without `tab` views gets a `pack` item hosting its WorkspaceBrowser +
// RunView. AccordionContent forceMount keeps collapsed surfaces alive
// (FR-007); the × on a header disables the owning pack
// (extension.changed reconciles).
import { useEffect, useState, type ReactNode } from "react";
import type { WorkspaceTab } from "@shared/types";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ExtViewHost } from "../extensions/ExtViewHost";
import { WorkspaceBrowser } from "../extensions/WorkspaceBrowser";
import { RunView } from "../extensions/RunView";
import { cn } from "@/lib/utils";

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

// The open item grows to fill free space — flex-grow animates smoothly
// (0→1 opens, 1→0 closes), pushing sibling headers along with it.
const itemCls =
  "relative flex min-h-0 flex-col transition-[flex-grow] duration-200 ease-out motion-reduce:transition-none data-[state=open]:grow";
const contentCls =
  "flex min-h-0 flex-col overflow-hidden bg-background data-[state=closed]:h-0 data-[state=open]:flex-1";

export function WorkspaceAccordion({
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

  // drop badges for items that vanished — a re-enabled pack starts clean
  useEffect(() => {
    setCrashed((s) => {
      const live = new Set(tabs.map((t) => t.id));
      const kept = [...s].filter((id) => live.has(id));
      return kept.length === s.size ? s : new Set(kept);
    });
  }, [tabs]);

  const closeBtn = (t: WorkspaceTab & { packId: string }) => (
    <button
      aria-label={`Close ${t.title}`}
      title="Disable pack"
      className="absolute right-8 top-2 z-10 rounded px-0.5 leading-none text-muted-foreground hover:bg-accent hover:text-foreground"
      onClick={(e) => {
        e.stopPropagation();
        onCloseTab(t.packId);
      }}
    >
      ×
    </button>
  );

  return (
    <Accordion
      type="single"
      collapsible={false}
      value={selectedId}
      onValueChange={select}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      data-testid="workspace-accordion"
    >
      <AccordionItem value="chat" className={itemCls} data-testid="workspace-item-chat">
        <AccordionTrigger title="Chat" className="data-[state=open]:bg-muted/50 data-[state=open]:text-foreground">
          <span className="truncate">Chat</span>
        </AccordionTrigger>
        <AccordionContent forceMount className={contentCls}>
          {chat}
        </AccordionContent>
      </AccordionItem>
      {tabs.map((t) => {
        if (t.kind === "ext") {
          const isCrashed = crashed.has(t.id);
          return (
            <AccordionItem key={t.id} value={t.id} className={itemCls} data-testid={`workspace-item-${t.id}`}>
              <AccordionTrigger
                title={`${t.title} — ${t.packName}`}
                className={cn(
                  "data-[state=open]:bg-muted/50 data-[state=open]:text-foreground",
                  isCrashed && "text-warning",
                )}
              >
                {isCrashed && <span className="shrink-0 text-warning">●</span>}
                <span className="truncate">{t.title}</span>
              </AccordionTrigger>
              {closeBtn(t)}
              <AccordionContent forceMount className={contentCls}>
                <div className="flex min-h-0 flex-1 flex-col">
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
              </AccordionContent>
            </AccordionItem>
          );
        }
        if (t.kind === "pack") {
          return (
            <AccordionItem key={t.id} value={t.id} className={itemCls} data-testid={`workspace-item-${t.id}`}>
              <AccordionTrigger
                title={t.title}
                className="data-[state=open]:bg-muted/50 data-[state=open]:text-foreground"
              >
                <span className="truncate">{t.title}</span>
              </AccordionTrigger>
              {closeBtn(t)}
              <AccordionContent forceMount className={contentCls}>
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
              </AccordionContent>
            </AccordionItem>
          );
        }
        return null;
      })}
    </Accordion>
  );
}
