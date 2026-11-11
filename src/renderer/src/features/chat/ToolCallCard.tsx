// feature 015: inline tool-call timeline card (FR-004/FR-006). Splits
// streamed content on ```tool_call / ```tool_result fences; call slots
// pair with ToolCallRecords by index and render the approval actions.
import { useState } from "react";
import { FileText, FolderOpen, Ban, CircleAlert, Loader2 } from "lucide-react";
import type { ToolCallRecord } from "@shared/types";
import {
  parseCallBody,
  scanBlocks,
  TOOL_CALL_FENCE,
  TOOL_RESULT_FENCE,
  type ToolBlock,
} from "@shared/tool-call";
import { Button } from "@/components/ui/button";
import { invoke } from "@/lib/rpc";
import { AiMessage } from "@/components/ai/ai-message";

const REFUSE_LABEL: Record<string, string> = {
  "out-of-sandbox": "outside sandbox",
  budget: "budget exhausted",
  malformed: "malformed call",
  disabled: "tools disabled",
};

function Card({ record, block }: { record?: ToolCallRecord; block: ToolBlock }) {
  const [busy, setBusy] = useState(false);
  // fallback: older messages may lack records — read the block itself
  const parsed = record ? null : parseCallBody(block.body);
  const tool = record?.tool ?? (parsed?.ok ? parsed.tool : null);
  const path = record?.path ?? (parsed?.ok ? parsed.path : "");
  const status = record?.status ?? "executed";

  const respond = (decision: "approve" | "deny" | "allowSession") => {
    if (!record) return;
    setBusy(true);
    void invoke("tool.respond", { callId: record.id, decision }).finally(() =>
      setBusy(false),
    );
  };

  const ToolIcon = tool === "list_dir" ? FolderOpen : FileText;
  return (
    <div className="my-2 rounded-md border border-border bg-background/60 px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <ToolIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium">{tool ?? "tool call"}</span>
        <span
          className="max-w-64 truncate font-mono text-muted-foreground"
          title={record?.resolvedPath ?? path}
        >
          {path || "(no path)"}
        </span>
        {status === "pending" ? (
          <span className="ml-auto inline-flex items-center gap-1 text-amber-500">
            <Loader2 className="size-3 animate-spin" /> awaiting approval
          </span>
        ) : status === "executed" ? (
          <span className="ml-auto text-emerald-500">executed</span>
        ) : status === "approved" ? (
          <span className="ml-auto text-emerald-500">approved</span>
        ) : status === "denied" ? (
          <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground">
            <Ban className="size-3" /> denied
          </span>
        ) : status === "refused" ? (
          <span className="ml-auto inline-flex items-center gap-1 text-red-500">
            <Ban className="size-3" />
            {REFUSE_LABEL[record?.refuseReason ?? ""] ?? "refused"}
          </span>
        ) : (
          <span className="ml-auto inline-flex items-center gap-1 text-red-500">
            <CircleAlert className="size-3" /> error
          </span>
        )}
      </div>
      {status === "pending" && record && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button
            size="sm"
            className="h-6 px-2 text-xs"
            disabled={busy}
            onClick={() => respond("approve")}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="h-6 px-2 text-xs"
            disabled={busy}
            onClick={() => respond("allowSession")}
          >
            Allow reads this session
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            disabled={busy}
            onClick={() => respond("deny")}
          >
            Deny
          </Button>
        </div>
      )}
      {record?.resultPreview && (
        <p className="mt-1.5 truncate text-muted-foreground">
          {record.resultPreview}
        </p>
      )}
      {status === "error" && record?.error && (
        <p className="mt-1.5 text-red-500">{record.error}</p>
      )}
    </div>
  );
}

// tool_result blocks are continuation artifacts — collapsed by default
function ResultDetails({ block }: { block: ToolBlock }) {
  let content = block.body;
  try {
    const v = JSON.parse(block.body) as { content?: string };
    if (typeof v.content === "string") content = v.content;
  } catch {
    /* show raw body */
  }
  return (
    <details className="my-1 rounded border border-border/60 bg-background/40 px-2 py-1 text-xs">
      <summary className="cursor-pointer select-none text-muted-foreground">
        tool result
      </summary>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono">
        {content}
      </pre>
    </details>
  );
}

// render one assistant message: markdown prose + tool cards in place of
// the fenced blocks (records zip with tool_call blocks by index)
export function ToolSegments({
  content,
  calls,
}: {
  content: string;
  calls: ToolCallRecord[];
}) {
  const blocks = scanBlocks(content);
  if (blocks.length === 0) return <AiMessage content={content} />;
  const out: React.ReactNode[] = [];
  let pos = 0;
  let callIdx = 0;
  for (const b of blocks) {
    if (b.start > pos) {
      const text = content.slice(pos, b.start);
      if (text.trim())
        out.push(<AiMessage key={`t${pos}`} content={text} />);
    }
    if (b.fence === TOOL_CALL_FENCE) {
      out.push(
        <Card key={`c${b.start}`} record={calls[callIdx++]} block={b} />,
      );
    } else if (b.fence === TOOL_RESULT_FENCE) {
      out.push(<ResultDetails key={`r${b.start}`} block={b} />);
    }
    pos = b.end;
  }
  const tail = content.slice(pos);
  if (tail.trim()) out.push(<AiMessage key={`t${pos}`} content={tail} />);
  // a trailing unclosed ```tool_call fence mid-stream renders as text —
  // the card appears once the block closes and tool.update lands
  return <>{out}</>;
}
