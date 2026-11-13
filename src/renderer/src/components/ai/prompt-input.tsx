import * as React from "react";
import { IconSparkle } from "@/components/icons";
import { cn } from "@/lib/utils";

// ai-elements "Prompt Input" recipe: a contained input group — actions
// left, textarea center, submit right — plus "Suggestion" chips above it.

export function PromptInput({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("border-t border-border bg-background p-4", className)}
      {...props}
    />
  );
}

export function PromptInputBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mx-auto flex max-w-2xl items-end gap-2 rounded-lg border border-input bg-background p-1.5 focus-within:ring-1 focus-within:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

export interface Suggestion {
  name: string;
  text: string;
}

// ai-elements "Suggestion": one-click prompt starters rendered as chips.
export function SuggestionChips({
  suggestions,
  onPick,
  className,
}: {
  suggestions: Suggestion[];
  onPick: (s: Suggestion) => void;
  className?: string;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className={cn("mx-auto mb-2 flex max-w-2xl flex-wrap gap-1.5", className)}>
      {suggestions.map((s) => (
        <button
          key={s.name}
          type="button"
          onClick={() => onPick(s)}
          title={s.text}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <IconSparkle className="size-3.5" />
          /{s.name}
        </button>
      ))}
    </div>
  );
}
