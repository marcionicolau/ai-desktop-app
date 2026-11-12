import * as React from "react";
import { ChevronRight, File, Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

// ai-elements "File Tree": nested collapsible folders + file rows.

export function FileTree({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="tree"
      className={cn("select-none text-sm", className)}
      {...props}
    />
  );
}

export function FileTreeFolder({
  name,
  defaultOpen,
  className,
  children,
}: {
  name: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className={className}>
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring">
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-90" />
        <Folder className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{name}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="ml-3 border-l border-border/60 pl-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function FileTreeFile({
  name,
  active,
  className,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "name"> & {
  name: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      role="treeitem"
      className={cn(
        "flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring",
        active && "bg-accent text-accent-foreground",
        className,
      )}
      {...props}
    >
      <span className="w-3.5 shrink-0" />
      <File className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{name}</span>
    </button>
  );
}
