import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ai-elements "Model Selector": trigger shows the active choice, the menu
// lists candidates with a check on the current one plus a footer action
// ("Manage…"). Two instances compose the fusion planner/executor pair.

export interface ModelOption {
  id: string;
  label: string;
  hint?: string; // e.g. file name
}

export function ModelSelector({
  label,
  value,
  options,
  onSelect,
  onManage,
  disabled,
  className,
}: {
  /** Menu section label, e.g. "Planner". */
  label: string;
  /** Currently selected option id; null → "Pick a model". */
  value: string | null;
  options: ModelOption[];
  onSelect: (id: string) => void;
  onManage?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const current = options.find((o) => o.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2 text-xs outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50",
            className,
          )}
        >
          <span className="text-muted-foreground">{label}:</span>
          <span className="max-w-40 truncate font-medium">
            {current?.label ?? "pick…"}
          </span>
          <ChevronsUpDown className="size-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs">{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.length === 0 && (
          <DropdownMenuItem disabled>No options</DropdownMenuItem>
        )}
        {options.map((o) => (
          <DropdownMenuItem key={o.id} onSelect={() => onSelect(o.id)}>
            <Check
              className={cn(
                "size-3.5",
                o.id === value ? "opacity-100" : "opacity-0",
              )}
            />
            <span className="truncate">{o.label}</span>
            {o.hint && (
              <span className="ml-auto truncate text-xs text-muted-foreground">
                {o.hint}
              </span>
            )}
          </DropdownMenuItem>
        ))}
        {onManage && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onManage}>Manage…</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
