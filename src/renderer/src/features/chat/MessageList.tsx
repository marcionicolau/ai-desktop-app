import { useEffect, useRef } from "react";
import type { Message } from "@shared/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const STATUS_HINT: Partial<Record<Message["status"], string>> = {
  generating: "generating…",
  partial: "stopped",
  failed: "failed",
};

export function MessageList({ messages }: { messages: Message[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [messages.length, messages.at(-1)?.content.length]);

  return (
    <ScrollArea className="flex-1">
      <div className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-6">
        {messages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">
            Send a message to start the conversation.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "rounded-lg px-4 py-2 text-sm leading-relaxed",
              m.role === "user"
                ? "ml-12 self-end bg-accent text-accent-foreground"
                : "mr-12 self-start bg-muted",
            )}
          >
            <p className="whitespace-pre-wrap break-words">{m.content}</p>
            {STATUS_HINT[m.status] && (
              <p className="mt-1 text-xs text-muted-foreground">
                {STATUS_HINT[m.status]}
              </p>
            )}
            {m.role === "assistant" && m.stats && (
              <p className="mt-1 text-xs text-muted-foreground">
                {m.stats.tokens} tokens · {m.stats.tokensPerSec} tok/s
              </p>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}
