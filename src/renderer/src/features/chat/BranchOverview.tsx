import type { Message } from "@shared/types";
import { IconUndo } from "@/components/icons";
import {
  Checkpoint,
  CheckpointIcon,
  CheckpointTrigger,
} from "@/components/ai/checkpoint";
import { cn } from "@/lib/utils";

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
            <div className="text-2xs uppercase tracking-wide text-muted-foreground">
              {b.variants.length} variants
            </div>
            <div className="mt-1 flex flex-col gap-1">
              {b.variants.map((v) => {
                const onPath = pathIds.has(v.id);
                return (
                  <Checkpoint
                    key={v.id}
                    className={cn(
                      "rounded px-1.5 py-1",
                      onPath
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50",
                    )}
                  >
                    <CheckpointIcon />
                    <button
                      type="button"
                      onClick={() => onSelect(v.id)}
                      className="min-w-0 flex-1 truncate text-left text-xs"
                    >
                      <span className="mr-1 text-muted-foreground">
                        {v.role === "user" ? "you:" : "ai:"}
                      </span>
                      {v.content.slice(0, 80) || "(empty)"}
                      {onPath && " · active"}
                    </button>
                    <CheckpointTrigger
                      aria-label="Return to this checkpoint"
                      title="Return to this checkpoint"
                      onClick={() => onSelect(v.id)}
                    >
                      <IconUndo className="h-3.5 w-3.5" />
                    </CheckpointTrigger>
                  </Checkpoint>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
