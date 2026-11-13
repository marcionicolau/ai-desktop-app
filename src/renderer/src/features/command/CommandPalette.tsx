// feature 026 (FR-010, FR-011): command palette — search conversations
// (titles instantly, message content via search.query once ≥ 3 chars),
// navigate to any surface, run common actions, switch model. Keyboard:
// type to filter, ↑/↓ to move, Enter to run, Esc to close; Radix returns
// focus to the previously focused element on close.
import { useEffect, useRef, useState } from "react";
import type { SearchGroup } from "@shared/types";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { IconChat } from "@/components/icons";
import { invoke } from "@/lib/rpc";
import { splitHighlight } from "./highlight";
import { isMacPlatform, shortcutLabel, type ActionEntry } from "@/lib/actions";

export interface PaletteModel {
  id: string;
  label: string;
  hint?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialQuery: string;
  actions: ActionEntry[];
  conversations: { id: string; title: string }[];
  models: PaletteModel[];
  onUseModel: (id: string) => void;
  onSelectConversation: (id: string, messageId?: string) => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  initialQuery,
  actions,
  conversations,
  models,
  onUseModel,
  onSelectConversation,
}: Props) {
  const mac = isMacPlatform();
  const [query, setQuery] = useState(initialQuery);
  const [hits, setHits] = useState<SearchGroup[]>([]);
  const seq = useRef(0);

  // each open starts from the requested query (e.g. "Use " for switch-model)
  useEffect(() => {
    if (open) setQuery(initialQuery);
    else setHits([]);
  }, [open, initialQuery]);

  // message-content search: ≥ 3 chars, 250 ms debounce, stale responses dropped
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 3) {
      setHits([]);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(() => {
      void invoke("search.query", { q })
        .then((r) => {
          if (mine === seq.current) setHits(r.groups.filter((g) => g.hits.length > 0));
        })
        .catch(() => {
          if (mine === seq.current) setHits([]);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  const close = () => onOpenChange(false);
  const runAction = (a: ActionEntry) => {
    if (!a.available().ok) return;
    close();
    // let the dialog unmount before an action opens another surface/dialog
    setTimeout(() => a.run(), 0);
  };

  const byGroup = (g: ActionEntry["group"]) => actions.filter((a) => a.group === g);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search chats, models and actions"
      showCloseButton={false}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search chats, models, actions…"
      />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>

        <CommandGroup heading="Actions">
          {byGroup("action").map((a) => {
            const av = a.available();
            return (
              <CommandItem
                key={a.id}
                value={`${a.label} ${a.keywords.join(" ")}`}
                disabled={!av.ok}
                onSelect={() => runAction(a)}
              >
                <span>{a.label}</span>
                {!av.ok && (
                  <span className="ml-2 truncate text-xs text-muted-foreground">
                    — {av.reason}
                  </span>
                )}
                {a.shortcut && (
                  <CommandShortcut>{shortcutLabel(a.shortcut, mac)}</CommandShortcut>
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>

        {models.length > 0 && (
          <CommandGroup heading="Models">
            {models.map((m) => (
              <CommandItem
                key={m.id}
                value={`Use ${m.label} ${m.hint ?? ""}`}
                onSelect={() => {
                  close();
                  setTimeout(() => onUseModel(m.id), 0);
                }}
              >
                <span>Use {m.label}</span>
                {m.hint && (
                  <span className="ml-2 truncate text-xs text-muted-foreground">{m.hint}</span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading="Go to">
          {byGroup("navigate").map((a) => (
            <CommandItem
              key={a.id}
              value={`${a.label} ${a.keywords.join(" ")}`}
              onSelect={() => runAction(a)}
            >
              {a.label}
            </CommandItem>
          ))}
        </CommandGroup>

        {conversations.length > 0 && (
          <CommandGroup heading="Conversations">
            {conversations.map((c) => (
              <CommandItem
                key={c.id}
                value={`chat ${c.title || "Untitled chat"} ${c.id}`}
                onSelect={() => {
                  close();
                  setTimeout(() => onSelectConversation(c.id), 0);
                }}
              >
                <IconChat aria-hidden="true" />
                <span className="truncate">{c.title || "Untitled chat"}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {hits.length > 0 && (
          <CommandGroup heading="Matches in messages">
            {hits.flatMap((g) =>
              g.hits.map((h) => (
                <CommandItem
                  key={`${g.conversationId}:${h.messageId}`}
                  // forceMount: these matched on content, not on the item text
                  forceMount
                  value={`hit ${g.conversationId} ${h.messageId}`}
                  onSelect={() => {
                    close();
                    setTimeout(() => onSelectConversation(g.conversationId, h.messageId), 0);
                  }}
                >
                  <IconChat aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{g.title || "Untitled chat"}</span>
                    <span className="flex items-baseline gap-2 text-xs text-muted-foreground">
                      <span className="min-w-0 flex-1 truncate">
                        {(() => {
                          const p = splitHighlight(h.snippet, h.matchStart, h.matchEnd);
                          return (
                            <>
                              {p.before}
                              <mark className="rounded-sm bg-warning/40 text-inherit">{p.match}</mark>
                              {p.after}
                            </>
                          );
                        })()}
                      </span>
                      <span className="shrink-0 text-2xs opacity-70">
                        {new Date(h.timestamp).toLocaleDateString()}
                      </span>
                    </span>
                  </span>
                </CommandItem>
              )),
            )}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
