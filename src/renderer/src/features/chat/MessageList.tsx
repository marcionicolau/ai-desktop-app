import { useEffect, useRef, useState } from "react";
import type { Message } from "@shared/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { AiMessage } from "@/components/ai/ai-message";
import { MessageActions } from "@/components/ai/message-actions";
import { cn } from "@/lib/utils";

const STATUS_HINT: Partial<Record<Message["status"], string>> = {
  generating: "generating…",
  partial: "stopped",
  failed: "failed",
};

interface Props {
  messages: Message[];
  generating: boolean;
  onRegenerate: (messageId: string) => void;
  onEdit: (messageId: string, content: string) => void;
}

export function MessageList({
  messages,
  generating,
  onRegenerate,
  onEdit,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [messages.length, messages.at(-1)?.content.length]);

  const commitEdit = (m: Message) => {
    const t = draft.trim();
    setEditingId(null);
    if (t && t !== m.content) onEdit(m.id, t);
  };

  return (
    <ScrollArea className="flex-1">
      <div className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-6">
        {messages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">
            Send a message to start the conversation.
          </p>
        )}
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          const canAct = !generating && m.status !== "generating";
          return (
            <div
              key={m.id}
              className={cn(
                "group rounded-lg px-4 py-2 text-sm leading-relaxed",
                m.role === "user"
                  ? "ml-12 self-end bg-accent text-accent-foreground"
                  : "mr-12 self-start bg-muted",
              )}
            >
              {m.role === "assistant" ? (
                <div className="break-words">
                  {m.status === "generating" && !m.content ? (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  ) : (
                    <AiMessage content={m.content} />
                  )}
                </div>
              ) : editingId === m.id ? (
                <div className="min-w-64">
                  <Textarea
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        commitEdit(m);
                      }
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="min-h-16 text-sm"
                  />
                  <div className="mt-1 flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => commitEdit(m)}>
                      Resend
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
              )}
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
              {canAct && editingId !== m.id && (
                <MessageActions
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  content={m.content}
                  canRegenerate={
                    m.role === "assistant" &&
                    isLast &&
                    (m.status === "complete" || m.status === "partial")
                  }
                  canEdit={m.role === "user" && m.status === "complete"}
                  onRegenerate={() => onRegenerate(m.id)}
                  onEdit={() => {
                    setEditingId(m.id);
                    setDraft(m.content);
                  }}
                />
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}
