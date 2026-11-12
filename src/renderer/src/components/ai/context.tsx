import { Gauge } from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// ai-elements "Context": token-usage indicator. Shows prompt tokens vs
// the model's context size; hidden when either number is unavailable.
export function ContextChip({
  used,
  total,
  className,
}: {
  used?: number | null;
  total?: number | null;
  className?: string;
}) {
  if (!used || !total || total <= 0) return null;
  const pct = Math.min(100, Math.round((used / total) * 100));
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground",
            className,
          )}
        >
          <Gauge className="size-3" />
          {used.toLocaleString()} / {total.toLocaleString()} tok
          <Progress
            value={pct}
            className={cn("h-1 w-10", pct > 85 && "[&>div]:bg-warning")}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {pct}% of the model context window in use
      </TooltipContent>
    </Tooltip>
  );
}
