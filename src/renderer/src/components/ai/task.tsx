import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Trace,
  TraceStep,
  TraceCollapsible,
  TraceDot,
  TraceBadge,
} from "@/components/ui/trace";

// ai-elements Task/Queue/Subagent over the Trace primitive.
// - Task    = one unit of work (a pipeline step)
// - Queue   = ordered collection of tasks
// - Subagent= a named group whose body is itself a step chain

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "skipped";

const DOT: Record<TaskStatus, "default" | "running" | "success" | "error"> = {
  queued: "default",
  running: "running",
  completed: "success",
  failed: "error",
  skipped: "default",
};

export interface TaskProps extends Omit<React.LiHTMLAttributes<HTMLLIElement>, "title"> {
  title: React.ReactNode;
  status?: TaskStatus;
  /** Right-side status override (badge/duration). */
  statusNode?: React.ReactNode;
  last?: boolean;
}

export function Task({ title, status = "queued", statusNode, last, className, children, ...props }: TaskProps) {
  return (
    <TraceStep
      icon={<TraceDot variant={DOT[status]} />}
      status={
        statusNode ?? (
          <TraceBadge
            className={cn(
              status === "failed" && "border-destructive/50 text-destructive",
              status === "completed" && "text-success",
              status === "running" && "text-primary",
            )}
          >
            {status}
          </TraceBadge>
        )
      }
      last={last}
      className={className}
      {...props}
    >
      <span className="text-sm">{title}</span>
      {children}
    </TraceStep>
  );
}

export function Queue({
  className,
  ...props
}: React.HTMLAttributes<HTMLOListElement>) {
  return <Trace className={className} {...props} />;
}

export interface SubagentProps {
  name: React.ReactNode;
  status?: TaskStatus;
  statusNode?: React.ReactNode;
  defaultOpen?: boolean;
  last?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function Subagent({ name, status = "running", statusNode, defaultOpen, last, className, children }: SubagentProps) {
  return (
    <TraceCollapsible
      icon={<TraceDot variant={DOT[status]} />}
      title={name}
      status={
        statusNode ?? (
          <TraceBadge
            className={cn(
              status === "failed" && "border-destructive/50 text-destructive",
              status === "completed" && "text-success",
            )}
          >
            {status}
          </TraceBadge>
        )
      }
      defaultOpen={defaultOpen}
      last={last}
      className={className}
    >
      {children}
    </TraceCollapsible>
  );
}
