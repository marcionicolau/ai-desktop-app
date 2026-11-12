import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  language?: string;
  code: string;
  className?: string;
}

export function CodeBlock({ language, code, className }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="not-typeset group relative my-2 overflow-hidden rounded-md border border-border">
      <div className="flex items-center justify-between bg-zinc-800 px-3 py-1.5">
        <span className="text-xs text-zinc-400">{language ?? "code"}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="text-zinc-400 hover:text-zinc-100"
          aria-label="Copy code"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <pre
        className={cn(
          "overflow-x-auto bg-zinc-900 p-3 text-xs text-zinc-100",
          className,
        )}
      >
        <code className={language ? `language-${language}` : undefined}>
          {code}
        </code>
      </pre>
    </div>
  );
}
