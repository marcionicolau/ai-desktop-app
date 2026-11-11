import { useState } from "react";
import { Check, Copy, Pencil, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  content: string;
  canRegenerate?: boolean;
  canEdit?: boolean;
  onRegenerate?: () => void;
  onEdit?: () => void;
  className?: string;
}

export function MessageActions({
  content,
  canRegenerate,
  canEdit,
  onRegenerate,
  onEdit,
  className,
}: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={cn("mt-1 flex items-center gap-1", className)}>
      <button
        type="button"
        onClick={() => void copy()}
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Copy message"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
      {canRegenerate && onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Regenerate reply"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      )}
      {canEdit && onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Edit message"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
