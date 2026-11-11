import { useState } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  generating: boolean;
  modelReady: boolean;
  onSend: (content: string) => void;
  onStop: () => void;
}

export function Composer({ generating, modelReady, onSend, onStop }: Props) {
  const [value, setValue] = useState("");
  const canSend = modelReady && !generating && value.trim().length > 0;

  const submit = () => {
    if (!canSend) return;
    onSend(value.trim());
    setValue("");
  };

  return (
    <div className="border-t border-border p-4">
      <div className="mx-auto flex max-w-2xl items-end gap-2">
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
