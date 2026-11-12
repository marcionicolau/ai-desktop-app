// feature 019: top-level tab strip — Chat fixed first (no close), ext/pack
// tabs titled with pack tooltip + × close (disables the owning pack),
// horizontal overflow scroll (FR-001/002/004/009/011).
import type { WorkspaceTab } from "@shared/types";

interface Props {
  tabs: WorkspaceTab[];
  selectedId: string;
  crashed?: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onCloseTab?: (packId: string) => void;
}

export function TabBar({ tabs, selectedId, crashed, onSelect, onCloseTab }: Props) {
  return (
    <div
      className="flex shrink-0 items-end gap-0.5 overflow-x-auto border-b border-border bg-muted/40 px-1 pt-1"
      role="tablist"
      data-testid="workspace-tabbar"
    >
      {tabs.map((t) => {
        const selected = t.id === selectedId;
        const isCrashed = t.kind === "ext" && crashed?.has(t.id);
        return (
          <div
            key={t.id}
            role="tab"
            aria-selected={selected}
            data-testid={`workspace-tab-${t.id}`}
            title={t.kind === "ext" ? `${t.title} — ${t.packName}` : t.title}
            onClick={() => onSelect(t.id)}
            className={`flex shrink-0 max-w-44 cursor-pointer items-center gap-1 rounded-t px-3 py-1.5 text-xs ${
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/60"
            }`}
          >
            {isCrashed && <span className="text-amber-400">●</span>}
            <span className="truncate">{t.title}</span>
            {t.kind !== "chat" && (
              <button
                aria-label={`Close ${t.title}`}
                title="Disable pack"
                className="ml-0.5 rounded px-0.5 leading-none text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab?.(t.packId);
                }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
