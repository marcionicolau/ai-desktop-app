import { Kbd } from "@/components/ui/kbd";
import { isMacPlatform, shortcutLabel } from "@/lib/actions";
import { EmptyState } from "@/components/empty-state";
import { useState } from "react";
import { IconChat, IconDelete, IconDownload, IconNewChat, IconUpload } from "@/components/icons";
import type { ConversationSummary } from "@shared/types";
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
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(null), 5000);
  };

  const visible = conversations;

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
          <Kbd className="ml-auto">
            {shortcutLabel({ key: "n", mod: true }, isMacPlatform())}
          </Kbd>
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
        {notice && (
          <p className="truncate px-1 text-xs text-muted-foreground" title={notice}>
            {notice}
          </p>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 && (
          <EmptyState
            compact
            icon={IconChat}
            title="No chats yet"
            description="Start one with New chat, or import an exported conversation."
          />
        )}
        {visible.map((c) => (

          <div
            key={c.id}
            className={cn(
              "group flex items-center gap-1 px-3 py-(--row-pad) text-sm",
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
