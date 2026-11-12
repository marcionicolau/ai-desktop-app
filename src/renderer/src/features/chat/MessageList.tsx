import { useEffect, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import type { Message as Msg } from "@shared/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trace, TraceCollapsible, TraceBadge } from "@/components/ui/trace";
import { Message, MessageContent, MessageToolbar } from "@/components/ai/message";
import { MessageActions } from "@/components/ai/message-actions";
import { ToolSegments } from "./ToolCallCard";
import { VariantNav } from "./VariantNav";
import { cn } from "@/lib/utils";

const STATUS_HINT: Partial<Record<Msg["status"], string>> = {
  generating: "generating…",
  partial: "stopped",
  failed: "failed",
};

interface Props {
  messages: Msg[]; // displayed path only (feature 005)
  variants: Map<string, { pos: number; ids: string[] }>;
  generating: boolean;
  // feature 007: search-jump target — scrolled into view + flashed
  scrollToId?: string | null;
  onRegenerate: (messageId: string) => void;
  onEdit: (messageId: string, content: string) => void;
  onSelectVariant: (messageId: string) => void;
}

export function MessageList({
  messages,
  variants,
  generating,
  scrollToId,
  onRegenerate,
  onEdit,
  onSelectVariant,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [flashId, setFlashId] = useState<string | null>(null);

  // scroll anchoring (ai-elements chat recipe): follow the tail only
  // while the user is pinned near the bottom; reading earlier turns
  // while streaming must not yank the view
  const trackPin = () => {
    const vp = rootRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (!vp) return;
    pinnedRef.current = vp.scrollHeight - vp.scrollTop - vp.clientHeight < 80;
  };

  useEffect(() => {
    if (scrollToId || !pinnedRef.current) return;
    endRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [messages.length, messages.at(-1)?.content.length, scrollToId]);

  useEffect(() => {
    if (!scrollToId) return;
    const el = document.getElementById(`msg-${scrollToId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "instant", block: "center" });
    setFlashId(scrollToId);
    const t = setTimeout(() => setFlashId(null), 2000);
    return () => clearTimeout(t);
  }, [scrollToId]);

  const commitEdit = (m: Msg) => {
    const t = draft.trim();
    setEditingId(null);
    if (t && t !== m.content) onEdit(m.id, t);
  };

  return (
    <ScrollArea className="flex-1" ref={rootRef} onScrollCapture={trackPin}>
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
        {messages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">
            Send a message to start the conversation.
          </p>
        )}
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          const canAct = !generating && m.status !== "generating";
          const v = variants.get(m.id);
          const plan = m.role === "assistant" ? m.phases?.plan : undefined;
          return (
            <Message
              key={m.id}
              id={`msg-${m.id}`}
              from={m.role}
              className={cn(flashId === m.id && "rounded-lg ring-2 ring-ring/60")}
            >
              <MessageContent from={m.role} className={cn(m.role === "assistant" && "w-full")}>
                {m.role === "user" && m.attachments && m.attachments.length > 0 && (
                  <div className="mb-1 flex flex-wrap gap-1">
                    {m.attachments.map((a) => (
                      <span
                        key={a.id}
                        className={cn(
                          "inline-flex items-center gap-1 rounded bg-background/40 px-1.5 py-0.5 text-[11px]",
                          a.status === "excluded" && "opacity-50 line-through",
                        )}
                        title={`${a.fileName} · ${a.status}`}
                      >
                        <Paperclip className="size-3" />
                        <span className="max-w-28 truncate">{a.fileName}</span>
                        {a.status === "truncated" && "·trunc"}
                        {a.status === "excluded" && "·skipped"}
                      </span>
                    ))}
                  </div>
                )}
                {plan && (
                  <Trace className="mb-2">
                    <TraceCollapsible
                      last
                      title={
                        <>
                          Plan
                          {plan.tag && (
                            <TraceBadge className="ml-2">{plan.tag}</TraceBadge>
                          )}
                          {plan.fileName && (
                            <span className="ml-1 text-muted-foreground">
                              ({plan.fileName})
                            </span>
                          )}
                        </>
                      }
                      status={
                        plan.stats ? (
                          <TraceBadge>
                            {plan.stats.tokens} tok · {plan.stats.tokensPerSec} tok/s
                          </TraceBadge>
                        ) : plan.servedBy === "fallback" ? (
                          <TraceBadge>via fallback</TraceBadge>
                        ) : undefined
                      }
                      defaultOpen={m.status === "generating" && !m.content}
                    >
                      <p className="whitespace-pre-wrap break-words">
                        {plan.content}
                      </p>
                    </TraceCollapsible>
                  </Trace>
                )}
                {m.role === "assistant" ? (
                  <div className="break-words">
                    {m.status === "generating" && !m.content ? (
                      <p className="whitespace-pre-wrap">{m.content}</p>
                    ) : (
                      // feature 015: tool_call/tool_result fences become
                      // inline cards; plain messages render unchanged
                      <ToolSegments
                        content={m.content}
                        calls={m.toolCalls ?? []}
                      />
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
                    {m.status === "generating" && m.phases
                      ? m.phases.answer
                        ? `answering… (${m.phases.answer.tag ?? "executor"})`
                        : `planning… (${m.phases.plan?.tag ?? "planner"})`
                      : STATUS_HINT[m.status]}
                  </p>
                )}
                {m.role === "assistant" &&
                  m.phases?.answer?.servedBy === "fallback" && (
                    <p className="mt-1 text-xs text-warning">
                      served by fallback {m.phases.answer.fileName}
                      {m.phases.answer.tag ? ` (${m.phases.answer.tag})` : ""}
                    </p>
                  )}
                {m.role === "assistant" && m.stats && (
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="secondary" className="font-normal">
                      {m.stats.tokens} tokens · {m.stats.tokensPerSec} tok/s
                    </Badge>
                  </div>
                )}
              </MessageContent>
              <MessageToolbar>
                {v && (
                  <VariantNav
                    pos={v.pos}
                    total={v.ids.length}
                    disabled={generating}
                    onPrev={() => onSelectVariant(v.ids[v.pos - 2]!)}
                    onNext={() => onSelectVariant(v.ids[v.pos]!)}
                  />
                )}
                {canAct && editingId !== m.id && (
                  <MessageActions
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
              </MessageToolbar>
            </Message>
          );
        })}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}
