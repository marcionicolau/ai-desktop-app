// ai-elements "Checkpoint": a flagged return point in the conversation —
// a marker row (icon + label + actions) used by the variant picker and
// the branch overview to navigate back to a fork point.
import { IconFlag } from "@/components/icons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function Checkpoint({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center gap-2 text-muted-foreground", className)}
      {...props}
    />
  );
}

export function CheckpointIcon({
  className,
  ...props
}: React.ComponentProps<typeof IconFlag>) {
  return <IconFlag className={cn("h-3.5 w-3.5", className)} {...props} />;
}

export function CheckpointLabel({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return <span className={cn("min-w-0 truncate text-xs", className)} {...props} />;
}

export function CheckpointTrigger({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("h-5 w-5", className)}
      {...props}
    />
  );
}
