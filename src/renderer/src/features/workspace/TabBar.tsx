// feature 019: top-level tab strip — Chat fixed first (no close), ext tabs
// titled with pack tooltip, horizontal overflow scroll (FR-001/002/004/009/011).
import type { WorkspaceTab } from "@shared/types";

interface Props {
  tabs: WorkspaceTab[];
  selectedId: string;
  crashed?: ReadonlySet<string>;
  onSelect: (id: string) => void;
}

export function TabBar({ tabs, selectedId, crashed, onSelect }: Props) {
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
          <button
            key={t.id}
            role="tab"
            aria-selected={selected}
            data-testid={`workspace-tab-${t.id}`}
            title={t.kind === "ext" ? `${t.title} — ${t.packName}` : t.title}
            onClick={() => onSelect(t.id)}
            className={`shrink-0 max-w-44 truncate rounded-t px-3 py-1.5 text-xs ${
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/60"
            }`}
          >
            {isCrashed && <span className="mr-1 text-amber-400">●</span>}
            {t.title}
          </button>
        );
      })}
    </div>
  );
}
