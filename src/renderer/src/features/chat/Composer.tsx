import { useRef, useState } from "react";
import { Paperclip, Send, Square, X } from "lucide-react";
import type { MessageAttachment, Snippet } from "@shared/types";
import { invoke } from "@/lib/rpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// feature 009: draft attachment chip — content stays main-side; the
// renderer holds id/name/size only (FR-010)
export interface DraftAttachment {
  id: string;
  fileName: string;
  sizeBytes: number;
}

const fmtSize = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`;

interface Props {
  generating: boolean;
  modelReady: boolean;
  snippets?: Snippet[];
  onSend: (
    content: string,
    attachmentIds: string[],
    chips: MessageAttachment[],
  ) => void;
  onStop: () => void;
  // opens model selection when no model is loaded (clickable hint)
  onPickModel?: () => void;
}

// feature 006 (T013): "/name" at the caret opens a filtered snippet picker;
// arrows cycle, Enter inserts the fragment in place of the token, Esc/blur
// dismisses. The picker namespace is shared with personas (collision rule).
interface Pick {
  start: number; // index of the "/" in value
  query: string;
  idx: number; // highlighted row
}

export function Composer({
  generating,
  modelReady,
  snippets = [],
  onSend,
  onStop,
  onPickModel,
}: Props) {
  const [value, setValue] = useState("");
  const [drafts, setDrafts] = useState<DraftAttachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const canSend = modelReady && !generating && value.trim().length > 0;

  const matches = pick
    ? snippets.filter((s) => s.name.startsWith(pick.query)).slice(0, 8)
    : [];

  const trackPick = (v: string, caret: number) => {
    const before = v.slice(0, caret);
    const m = /(?:^|\s)\/([a-z0-9-]*)$/.exec(before);
    const query = m?.[1];
    setPick(
      m && query !== undefined
        ? { start: caret - query.length - 1, query, idx: 0 }
        : null,
    );
  };

  const insertSnippet = (s: Snippet) => {
    if (!pick) return;
    const caret = areaRef.current?.selectionStart ?? value.length;
    const next = value.slice(0, pick.start) + s.text + value.slice(caret);
    setValue(next);
    const pos = pick.start + s.text.length;
    setPick(null);
    requestAnimationFrame(() => {
      areaRef.current?.setSelectionRange(pos, pos);
      areaRef.current?.focus();
    });
  };

  const submit = () => {
    if (!canSend) return;
    // optimistic chips: status truth lands on the persisted message
    // (server recomputes at send; warning covers truncation)
    onSend(
      value.trim(),
      drafts.map((d) => d.id),
      drafts.map((d) => ({
        id: d.id,
        fileName: d.fileName,
        sizeBytes: d.sizeBytes,
        status: "full" as const,
      })),
    );
    setValue("");
    setDrafts([]);
  };

  const pickAttachments = async () => {
    try {
      const r = await invoke("attachment.pick", {});
      if (!r) return; // cancelled
      setDrafts((d) => {
        const have = new Set(d.map((x) => x.id));
        return [...d, ...r.picked.filter((x) => !have.has(x.id))];
      });
      if (r.rejected.length) {
        setNotice(
          r.rejected.map((x) => `${x.fileName}: ${x.reason}`).join("; "),
        );
        setTimeout(() => setNotice(null), 6000);
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
      setTimeout(() => setNotice(null), 6000);
    }
  };

  return (
    <div className="border-t border-border p-4">
      {(drafts.length > 0 || notice) && (
        <div className="mx-auto mb-2 flex max-w-2xl flex-wrap items-center gap-1">
          {drafts.map((d) => (
            <span
              key={d.id}
              className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
              title={d.fileName}
            >
              <Paperclip className="size-3" />
              <span className="max-w-32 truncate">{d.fileName}</span>
              <span className="text-muted-foreground">{fmtSize(d.sizeBytes)}</span>
              <button
                className="ml-0.5 rounded hover:text-red-400"
                onClick={() =>
                  setDrafts((x) => x.filter((y) => y.id !== d.id))
                }
                title={`Remove ${d.fileName}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          {notice && (
            <span className="text-xs text-amber-300">{notice}</span>
          )}
        </div>
      )}
      {pick && matches.length > 0 && (
        <div className="mx-auto mb-2 max-w-2xl rounded-md border border-border bg-background shadow-lg">
          {matches.map((s, i) => (
            <button
              key={s.name}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                i === pick.idx ? "bg-muted" : "hover:bg-muted/50"
              }`}
              // onMouseDown so the pick lands before textarea blur dismisses it
              onMouseDown={(e) => {
                e.preventDefault();
                insertSnippet(s);
              }}
            >
              <span className="font-medium">/{s.name}</span>
              <span className="truncate text-muted-foreground">{s.text}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mx-auto flex max-w-2xl items-end gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void pickAttachments()}
          disabled={!modelReady}
          title="Attach files"
        >
          <Paperclip />
        </Button>
        <Textarea
          ref={areaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            trackPick(e.target.value, e.target.selectionStart);
          }}
          onSelect={(e) =>
            trackPick(value, e.currentTarget.selectionStart)
          }
          onBlur={() => setPick(null)}
          onKeyDown={(e) => {
            // "/" picker navigation swallows keys while open (feature 006)
            if (pick && matches.length) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setPick({ ...pick, idx: (pick.idx + 1) % matches.length });
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setPick({
                  ...pick,
                  idx: (pick.idx - 1 + matches.length) % matches.length,
                });
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                insertSnippet(matches[pick.idx] ?? matches[0]!);
                return;
              }
              if (e.key === "Escape") {
                setPick(null);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            modelReady ? "Type a message…" : "Load a model to start chatting"
          }
          disabled={!modelReady}
          rows={2}
          className="resize-none"
        />
        {generating ? (
          <Button
            variant="secondary"
            size="icon"
            onClick={onStop}
            title="Stop generation"
          >
            <Square />
          </Button>
        ) : (
          <Button
            size="icon"
            onClick={submit}
            disabled={!canSend}
            title={modelReady ? "Send" : "No model loaded"}
          >
            <Send />
          </Button>
        )}
      </div>
      {!modelReady && (
        <p className="mx-auto mt-2 max-w-2xl text-xs text-muted-foreground">
          No model loaded —{" "}
          <button
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => onPickModel?.()}
          >
            open the model picker
          </button>{" "}
          to start chatting.
        </p>
      )}
      {generating && (
        <p className="mx-auto mt-2 max-w-2xl text-xs text-muted-foreground">
          Generating — sending is disabled until this response finishes.
        </p>
      )}
    </div>
  );
}
