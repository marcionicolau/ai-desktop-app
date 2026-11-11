import { FolderOpen, Loader2 } from "lucide-react";
import type { ModelStatus } from "@shared/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  status: ModelStatus;
  name: string | null;
  error: string | null;
  onPick: () => void;
}

const STATUS_STYLE: Record<ModelStatus, string> = {
  ready: "text-emerald-400",
  loading: "text-amber-400",
  error: "text-red-400",
  unloaded: "text-muted-foreground",
};

export function ModelPicker({ status, name, error, onPick }: Props) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("text-xs", STATUS_STYLE[status])}>
        {status === "loading" ? (
          <span className="inline-flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" />
            loading…
          </span>
        ) : status === "ready" ? (
          (name ?? "ready")
        ) : status === "error" ? (
          `error${error ? `: ${error}` : ""}`
        ) : (
          "no model"
        )}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onPick}
        disabled={status === "loading"}
        title="Choose a .gguf model file"
      >
        <FolderOpen /> Model
      </Button>
    </div>
  );
}
