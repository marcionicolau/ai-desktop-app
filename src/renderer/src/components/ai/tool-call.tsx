import * as React from "react";
import { IconChevronDown } from "@/components/icons";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// ai-elements "Tool" recipe: a step card with icon + name + status badge,
// collapsible input/output panels, and a stack-trace body for failures.

export type ToolCallStatus =
  | "pending"
  | "executed"
  | "approved"
  | "denied"
  | "refused"
  | "error";

const STATUS_VARIANT: Record<ToolCallStatus, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
  pending: { variant: "default", label: "awaiting approval" },
  executed: { variant: "secondary", label: "executed" },
  approved: { variant: "secondary", label: "approved" },
  denied: { variant: "outline", label: "denied" },
  refused: { variant: "destructive", label: "refused" },
  error: { variant: "destructive", label: "error" },
};

export interface ToolCallProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  name: React.ReactNode;
  /** Right-side detail next to the name (e.g. the target path). */
  detail?: React.ReactNode;
  status: ToolCallStatus;
  /** Replaces the computed status badge. */
  statusNode?: React.ReactNode;
}

export function ToolCall({
  icon,
  name,
  detail,
  status,
  statusNode,
  className,
  children,
  ...props
}: ToolCallProps) {
  const s = STATUS_VARIANT[status];
  return (
    <div
      className={cn(
        "not-typeset my-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-card-foreground",
        status === "pending" && "border-warning/60",
        status === "error" && "border-destructive/60",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-medium">{name}</span>
        {detail}
        <span className="ml-auto">
          {statusNode ?? (
            <Badge
              variant={s.variant}
              className={cn(
                "font-normal",
                status === "pending" && "animate-pulse",
                (status === "executed" || status === "approved") &&
                  "border-transparent bg-success/15 text-success",
              )}
            >
              {s.label}
            </Badge>
          )}
        </span>
      </div>
      {children}
    </div>
  );
}

/** Collapsible body section inside a ToolCall (input params, result). */
export function ToolCallSection({
  title,
  defaultOpen,
  className,
  children,
}: {
  title: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className={cn("mt-1.5", className)}>
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-sm text-left text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <IconChevronDown className="size-3.5 transition-transform duration-200 group-data-[state=closed]:-rotate-90" />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 overflow-hidden data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** ai-elements "Stack Trace": preformatted failure body. */
export function ToolCallError({ error, className }: { error: string; className?: string }) {
  return (
    <pre
      className={cn(
        "mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-destructive/10 p-2 font-mono text-destructive",
        className,
      )}
    >
      {error}
    </pre>
  );
}
