// feature 026 (FR-025, FR-026): the chat column. With the Metrics panel open
// it becomes a vertical split — conversation above, metrics below — whose
// divider can be dragged or moved with the arrow keys; the split is
// remembered per window and restored by Reset layout. With the panel closed
// it is a plain column, exactly as before.
import { useEffect, useState, type ReactNode } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { onLayoutReset, readLayout, writeLayout } from "@/lib/layout";

const GROUP_ID = "chat-vertical";
const PANELS = ["chat", "metrics"];

export function ChatColumn({
  metricsOpen,
  metrics,
  children,
}: {
  metricsOpen: boolean;
  metrics: ReactNode;
  children: ReactNode;
}) {
  // remount on reset so the group re-reads its (now default) layout
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => onLayoutReset(() => setResetKey((k) => k + 1)), []);

  if (!metricsOpen) {
    return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
  }
  return (
    <ResizablePanelGroup
      key={resetKey}
      id={GROUP_ID}
      orientation="vertical"
      className="h-auto min-h-0 flex-1"
      defaultLayout={readLayout(GROUP_ID, PANELS)}
      onLayoutChanged={(layout) => writeLayout(GROUP_ID, layout)}
    >
      {/* the conversation keeps at least 40% so messages never shrink to a sliver */}
      <ResizablePanel id="chat" defaultSize="75" minSize="40">
        <div className="flex h-full min-h-0 flex-col">{children}</div>
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="Resize metrics panel" />
      <ResizablePanel id="metrics" defaultSize="25" minSize="10" maxSize="50">
        {metrics}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
