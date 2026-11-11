import { useEffect, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import type { Message } from "@shared/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { MessageActions } from "@/components/ai/message-actions";
import { ToolSegments } from "./ToolCallCard";
import { VariantNav } from "./VariantNav";
import { cn } from "@/lib/utils";

const STATUS_HINT: Partial<Record<Message["status"], string>> = {
  generating: "generating…",
  partial: "stopped",
  failed: "failed",
};

interface Props {
  messages: Message[]; // displayed path only (feature 005)
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
  const endRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [flashId, setFlashId] = useState<string | null>(null);

  useEffect(() => {
    // a search jump owns the scroll — skip the tail-follow that render
    if (scrollToId) return;
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
          const v = variants.get(m.id);
          return (
            <div
              key={m.id}
              id={`msg-${m.id}`}
              className={cn(
                "group rounded-lg px-4 py-2 text-sm leading-relaxed",
                flashId === m.id && "ring-2 ring-amber-500/60",
                m.role === "user"
                  ? "ml-12 self-end bg-accent text-accent-foreground"
                  : "mr-12 self-start bg-muted",
              )}
            >
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
              {m.role === "assistant" && m.phases?.plan && (
                <details
                  className="mb-2 rounded border border-border bg-background/50 px-2 py-1 text-xs"
                  open={m.status === "generating" && !m.content}
                >
                  <summary className="cursor-pointer select-none text-muted-foreground">
                    Plan
                    {m.phases.plan.tag && ` · ${m.phases.plan.tag}`}
                    {m.phases.plan.fileName && ` (${m.phases.plan.fileName})`}
                    {m.phases.plan.servedBy === "fallback" && " · via fallback"}
                    {m.phases.plan.stats &&
                      ` · ${m.phases.plan.stats.tokens} tok · ${m.phases.plan.stats.tokensPerSec} tok/s`}
                  </summary>
                  <p className="mt-1 whitespace-pre-wrap break-words">
                    {m.phases.plan.content}
                  </p>
                </details>
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
                  <p className="mt-1 text-xs text-amber-500">
                    served by fallback {m.phases.answer.fileName}
                    {m.phases.answer.tag ? ` (${m.phases.answer.tag})` : ""}
                  </p>
                )}
              {m.role === "assistant" && m.stats && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {m.stats.tokens} tokens · {m.stats.tokensPerSec} tok/s
                </p>
              )}
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
