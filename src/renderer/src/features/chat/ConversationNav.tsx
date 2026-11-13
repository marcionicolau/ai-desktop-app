import { useEffect, useRef, useState } from "react";
import { IconDelete, IconDownload, IconNewChat, IconSearch, IconUpload } from "@/components/icons";
import type { ConversationSummary, SearchGroup } from "@shared/types";
import { invoke } from "@/lib/rpc";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Props {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string, format: "markdown" | "json") => Promise<string | null>;
  onImport: () => Promise<string | null>;
  // feature 007: search-hit navigation (conversationId, messageId)
  onSelectHit: (conversationId: string, messageId: string) => void;
}

export function ConversationNav({
  conversations,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onExport,
  onImport,
  onSelectHit,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [filter, setFilter] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // feature 007: ≥3 chars flips the sidebar into grouped search results;
  // seq-guard drops stale responses (US2 debounce correctness)
  const [results, setResults] = useState<SearchGroup[] | null>(null);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);
  const query = filter.trim();
  const searchMode = query.length >= 3;

  useEffect(() => {
    if (!searchMode) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const mine = ++seq.current;
    const t = setTimeout(() => {
      void invoke("search.query", { q: query })
        .then((r) => {
          if (seq.current === mine) {
            setResults(r.groups);
            setSearching(false);
          }
        })
        .catch(() => {
          if (seq.current === mine) {
            setResults([]);
            setSearching(false);
          }
        });
    }, 250);
    return () => clearTimeout(t);
  }, [query, searchMode]);

  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(null), 5000);
  };

  const visible = filter.trim()
    ? conversations.filter((c) =>
        c.title.toLowerCase().includes(filter.trim().toLowerCase()),
      )
    : conversations;

  const commitRename = (id: string) => {
    const t = editValue.trim();
    if (t) onRename(id, t);
    setEditingId(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border space-y-2 p-2">
        <Button
          variant="secondary"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={onNew}
        >
          <IconNewChat /> New chat
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => {
            void onImport()
              .then((id) => {
                if (!id) return; // cancelled
                flash("Conversation imported.");
              })
              .catch((e: unknown) => {
                flash(
                  `Import failed: ${e instanceof Error ? e.message : String(e)}`,
                );
              });
          }}
        >
          <IconUpload /> Import…
        </Button>
        <div className="relative">
          <IconSearch className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search all chats…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setFilter("");
            }}
            className="h-7 pl-7 text-sm"
            aria-label="Search conversations"
          />
        </div>
        {notice && (
          <p className="truncate px-1 text-xs text-muted-foreground" title={notice}>
            {notice}
          </p>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {searchMode ? (
          <div className="p-1">
            {searching && results === null && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Searching…
              </p>
            )}
            {results !== null && results.length === 0 && !searching && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                No results for "{query}".
              </p>
            )}
            {results?.map((g) => (
              <div key={g.conversationId} className="mb-1">
                <button
                  className="w-full truncate rounded px-2 py-1 text-left text-xs font-medium hover:bg-muted"
                  title={g.title}
                  onClick={() =>
                    g.hits[0]
                      ? onSelectHit(g.conversationId, g.hits[0].messageId)
                      : onSelect(g.conversationId)
                  }
                >
                  {g.title}
                  {g.titleMatched && (
                    <span className="ml-1 text-2xs text-muted-foreground">
                      (title)
                    </span>
                  )}
                </button>
                {g.hits.map((h) => (
                  <button
                    key={h.messageId}
                    className="flex w-full items-baseline rounded px-4 py-0.5 text-left text-2xs text-muted-foreground hover:bg-muted"
                    onClick={() => onSelectHit(g.conversationId, h.messageId)}
                    title={h.snippet}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {h.snippet.slice(0, h.matchStart)}
                      <mark className="rounded-sm bg-warning/40 text-inherit">
                        {h.snippet.slice(h.matchStart, h.matchEnd)}
                      </mark>
                      {h.snippet.slice(h.matchEnd)}
                    </span>
                    <span className="ml-1.5 shrink-0 text-2xs text-muted-foreground/60">
                      {new Date(h.timestamp).toLocaleDateString()}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        ) : null}
        {!searchMode && visible.length === 0 && conversations.length > 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            No chats match "{filter.trim()}".
          </p>
        )}
        {!searchMode &&
          visible.map((c) => (
          <div
            key={c.id}
            className={cn(
              "group flex items-center gap-1 px-3 py-2 text-sm",
              c.id === activeId
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50",
            )}
          >
            {editingId === c.id ? (
              <Input
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => commitRename(c.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(c.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
                className="h-7 px-1 text-sm"
              />
            ) : (
              <button
                className="flex-1 truncate text-left"
                onClick={() => onSelect(c.id)}
                onDoubleClick={() => {
                  setEditingId(c.id);
                  setEditValue(c.title);
                }}
                title={c.title}
              >
                {c.title}
              </button>
            )}
            {/* feature 006 (FR-006): active persona badge */}
            {c.personaName && editingId !== c.id && (
              <span
                className="shrink-0 rounded bg-muted px-1 py-0.5 text-2xs text-muted-foreground"
                title={`Persona: ${c.personaName}`}
              >
                {c.personaName}
              </span>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  className="invisible shrink-0 rounded p-1 text-muted-foreground hover:text-foreground group-hover:visible"
                  title="Export conversation"
                >
                  <IconDownload className="size-3.5" />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Export conversation</AlertDialogTitle>
                  <AlertDialogDescription>
                    Choose a format for "{c.title}". You'll pick a folder next;
                    cancelled pickers are ignored.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      void onExport(c.id, "markdown").then((p) => {
                        if (p) flash(`Exported to ${p}`);
                      });
                    }}
                  >
                    Markdown
                  </AlertDialogAction>
                  <AlertDialogAction
                    onClick={() => {
                      void onExport(c.id, "json").then((p) => {
                        if (p) flash(`Exported to ${p}`);
                      });
                    }}
                  >
                    JSON
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  className="invisible shrink-0 rounded p-1 text-muted-foreground hover:text-destructive group-hover:visible"
                  title="Delete conversation"
                >
                  <IconDelete className="size-3.5" />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
                  <AlertDialogDescription>
                    "{c.title}" and all its messages will be permanently
                    removed. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive hover:bg-destructive"
                    onClick={() => onDelete(c.id)}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ))}
      </div>
    </div>
  );
}
