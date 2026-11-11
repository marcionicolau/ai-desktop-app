import { useState } from "react";
import { Paperclip, Send, Square, X } from "lucide-react";
import type { MessageAttachment } from "@shared/types";
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
  onSend: (
    content: string,
    attachmentIds: string[],
    chips: MessageAttachment[],
  ) => void;
  onStop: () => void;
}

export function Composer({ generating, modelReady, onSend, onStop }: Props) {
  const [value, setValue] = useState("");
  const [drafts, setDrafts] = useState<DraftAttachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const canSend = modelReady && !generating && value.trim().length > 0;

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

  const pick = async () => {
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
      <div className="mx-auto flex max-w-2xl items-end gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void pick()}
          disabled={!modelReady}
          title="Attach files"
        >
          <Paperclip />
        </Button>
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
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
          No model loaded — load one via the model picker or MODEL_PATH.
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
