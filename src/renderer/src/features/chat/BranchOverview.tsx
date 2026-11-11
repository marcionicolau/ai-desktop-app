import type { Message } from "@shared/types";

interface Branch {
  parentId: string | null;
  variants: Message[];
}

interface Props {
  branches: Branch[];
  pathIds: Set<string>;
  onSelect: (messageId: string) => void;
  onClose: () => void;
}

// lightweight branch overview (feature 005 US3): every point where the
// conversation forked, with a preview per variant; click navigates.
export function BranchOverview({ branches, pathIds, onSelect, onClose }: Props) {
  return (
    <div className="border-b border-border bg-muted/40 px-4 py-2">
      <div className="mx-auto flex max-w-2xl items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Branches ({branches.length})
        </span>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:underline"
          onClick={onClose}
        >
          close
        </button>
      </div>
      <div className="mx-auto mt-1 flex max-w-2xl flex-col gap-2 pb-1">
        {branches.map((b) => (
          <div
            key={b.parentId ?? "root"}
            className="rounded border border-border bg-background px-2 py-1"
          >
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {b.variants.length} variants
            </div>
            <div className="mt-1 flex flex-col gap-1">
              {b.variants.map((v) => {
                const onPath = pathIds.has(v.id);
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => onSelect(v.id)}
                    className={
                      "truncate rounded px-2 py-1 text-left text-xs " +
                      (onPath
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50")
                    }
                  >
                    <span className="mr-1 text-muted-foreground">
                      {v.role === "user" ? "you:" : "ai:"}
                    </span>
                    {v.content.slice(0, 80) || "(empty)"}
                    {onPath && " · active"}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
