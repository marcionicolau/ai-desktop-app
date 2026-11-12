import * as React from "react";
import { cn } from "@/lib/utils";

// ai-elements "Message" recipe: role-aware container + content surface.
// Assistant messages render full-width prose (typeset); user messages are
// right-aligned chips. Actions slot is hover-revealed by the container.

export interface MessageProps extends React.HTMLAttributes<HTMLDivElement> {
  from: "user" | "assistant" | "system";
}

const Message = React.forwardRef<HTMLDivElement, MessageProps>(
  ({ from, className, ...props }, ref) => (
    <div
      ref={ref}
      data-role={from}
      className={cn(
        "group flex flex-col gap-1 text-sm leading-relaxed",
        from === "user" ? "items-end pl-12" : "items-start pr-12",
        className,
      )}
      {...props}
    />
  ),
);
Message.displayName = "Message";

const MessageContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { from?: "user" | "assistant" | "system" }
>(({ from = "assistant", className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "min-w-0 break-words rounded-lg px-4 py-2",
      from === "user"
        ? "bg-primary text-primary-foreground"
        : "bg-muted text-foreground",
      className,
    )}
    {...props}
  />
));
MessageContent.displayName = "MessageContent";

const MessageToolbar = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
      className,
    )}
    {...props}
  />
));
MessageToolbar.displayName = "MessageToolbar";

export { Message, MessageContent, MessageToolbar };
