import { useState } from "react";
import { MessageSquarePlus, Trash2 } from "lucide-react";
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
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const commitRename = (id: string) => {
    const t = editValue.trim();
    if (t) onRename(id, t);
    setEditingId(null);
  };

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border">
      <div className="border-b border-border p-2">
        <Button
          variant="secondary"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={onNew}
        >
          <MessageSquarePlus /> New chat
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {conversations.map((c) => (
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
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  className="invisible shrink-0 rounded p-1 text-muted-foreground hover:text-red-400 group-hover:visible"
                  title="Delete conversation"
                >
                  <Trash2 className="size-3.5" />
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
                    className="bg-red-700 hover:bg-red-600"
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
    </aside>
  );
}
