// feature 026 (FR-003): one empty-state pattern for every list and panel —
// says why it is empty and, when there is one, offers the primary next action.
import type { ReactNode } from "react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import type { IconComponent } from "@/components/icons";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: IconComponent;
  title: string;
  description?: ReactNode;
  action?: { label: string; onClick: () => void };
  // tight variant for sidebars and small panels
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact,
  className,
}: EmptyStateProps) {
  return (
    <Empty className={cn(compact ? "gap-3 p-3 md:p-3" : "gap-4 p-6 md:p-8", className)}>
      <EmptyHeader>
        {Icon && (
          <EmptyMedia variant="icon">
            <Icon aria-hidden="true" />
          </EmptyMedia>
        )}
        <EmptyTitle className={cn(compact && "text-sm")}>{title}</EmptyTitle>
        {description && (
          <EmptyDescription className={cn(compact && "text-xs")}>{description}</EmptyDescription>
        )}
      </EmptyHeader>
      {action && (
        <EmptyContent>
          <Button size="sm" variant="outline" onClick={action.onClick}>
            {action.label}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}
