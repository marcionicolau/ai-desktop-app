import * as React from "react";
import { IconChevronDown } from "@/components/icons";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";

/**
 * Step-chain primitive (shadcn "Trace" recipe) — a vertical chain of
 * process steps with status dots, used for plan phases, tool calls,
 * and run steps. Children are <TraceStep> or <TraceCollapsible>.
 */
const Trace = React.forwardRef<HTMLOListElement, React.HTMLAttributes<HTMLOListElement>>(
  ({ className, ...props }, ref) => (
    <ol ref={ref} className={cn("relative space-y-0", className)} {...props} />
  ),
);
Trace.displayName = "Trace";

export interface TraceStepProps extends React.LiHTMLAttributes<HTMLLIElement> {
  /** Content rendered to the left in the connecting rail — defaults to a status dot. */
  icon?: React.ReactNode;
  /** Node passed as the step's right-side badge/status slot. */
  status?: React.ReactNode;
  /** Whether this is the last step (hides the connecting rail below it). */
  last?: boolean;
}

const TraceStep = React.forwardRef<HTMLLIElement, TraceStepProps>(
  ({ className, icon, status, last, children, ...props }, ref) => (
    <li ref={ref} className={cn("relative pl-6 pb-3", className)} {...props}>
      {!last && (
        <span
          aria-hidden
          className="absolute left-[5px] top-4 bottom-0 w-px bg-border"
        />
      )}
      <span
        aria-hidden
        className="absolute left-0 top-1.5 flex h-[11px] w-[11px] items-center justify-center"
      >
        {icon ?? <span className="h-2 w-2 rounded-full bg-muted-foreground" />}
      </span>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        {status ? <div className="shrink-0">{status}</div> : null}
      </div>
    </li>
  ),
);
TraceStep.displayName = "TraceStep";

export interface TraceCollapsibleProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof Collapsible>,
    "children" | "title"
  > {
  /** Trigger label — the step title. */
  title: React.ReactNode;
  /** Optional right-side status (badge, duration, icon). */
  status?: React.ReactNode;
  /** Content revealed when expanded. */
  children?: React.ReactNode;
  /** Step icon override. */
  icon?: React.ReactNode;
  /** Whether this is the last step in the chain. */
  last?: boolean;
}

/**
 * A <TraceStep> whose body is a Collapsible — the chain-of-thought
 * expand/collapse pattern from ai-elements.
 */
function TraceCollapsible({
  title,
  status,
  children,
  icon,
  last,
  className,
  defaultOpen,
  ...props
}: TraceCollapsibleProps) {
  return (
    <Collapsible defaultOpen={defaultOpen} {...props} asChild>
      <li className={cn("relative pl-6 pb-3", className)}>
        {!last && (
          <span aria-hidden className="absolute left-[5px] top-4 bottom-0 w-px bg-border" />
        )}
        <span
          aria-hidden
          className="absolute left-0 top-1.5 flex h-[11px] w-[11px] items-center justify-center"
        >
          {icon ?? <span className="h-2 w-2 rounded-full bg-muted-foreground" />}
        </span>
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-sm text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex min-w-0 items-center gap-2">
            <IconChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]:-rotate-90" />
            <span className="truncate">{title}</span>
          </span>
          {status ? <span className="shrink-0">{status}</span> : null}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-1.5 overflow-hidden text-sm text-muted-foreground data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0">
          {children}
        </CollapsibleContent>
      </li>
    </Collapsible>
  );
}

/** Small status dot variants for TraceStep/TraceCollapsible `icon`. */
function TraceDot({ variant }: { variant: "default" | "running" | "success" | "error" }) {
  const cls = {
    default: "bg-muted-foreground",
    running: "bg-primary animate-pulse",
    success: "bg-emerald-500",
    error: "bg-destructive",
  }[variant];
  return <span className={cn("h-2 w-2 rounded-full", cls)} />;
}

function TraceBadge({ className, ...props }: React.ComponentProps<typeof Badge>) {
  return <Badge variant="outline" className={cn("font-normal", className)} {...props} />;
}

export { Trace, TraceStep, TraceCollapsible, TraceDot, TraceBadge };
