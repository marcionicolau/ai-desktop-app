// feature 026 (FR-019): a disabled control must say why. Wraps a control and,
// while `reason` is set, shows it in a tooltip on hover and keyboard focus.
// Disabled buttons receive no pointer or focus events, so the wrapper span is
// the focusable, hoverable target.
import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function WithReason({
  reason,
  children,
}: {
  reason: string | undefined;
  children: ReactNode;
}) {
  if (!reason) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a disabled button gets no focus or hover, so this wrapper is the keyboard/pointer target for the reason tooltip */}
        <span tabIndex={0} className="inline-flex" aria-label={reason}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

// the reason a send is unavailable, or undefined when it is available
export function sendDisabledReason(opts: {
  modelReady: boolean;
  generating: boolean;
  hasText: boolean;
}): string | undefined {
  if (!opts.modelReady) return "No model is loaded — open the model picker";
  if (opts.generating) return "A reply is being generated — stop it or wait";
  if (!opts.hasText) return "Type a message to send";
  return undefined;
}
