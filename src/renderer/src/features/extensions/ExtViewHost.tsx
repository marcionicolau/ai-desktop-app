// feature 017 (US4): host slot for an extension BrowserView. The native
// view is a window-level child positioned over this div — a ResizeObserver
// pushes bounds via view.setBounds (FR-013). A view.error shows a contained
// crash state with reload (re-open), never taking the host down (FR-016).
import { useEffect, useRef, useState } from "react";
import { invoke, on } from "@/lib/rpc";
import { Button } from "@/components/ui/button";

interface Props {
  packId: string;
  viewId: string;
  onClose: () => void;
}

export function ExtViewHost({ packId, viewId, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [crashed, setCrashed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    void invoke("view.open", { packId, viewId, slot: "panel" })
      .then((r) => {
        setSessionId(r.sessionId);
        setCrashed(null);
      })
      .catch((e: Error) => setError(e.message));
  };
  useEffect(open, [packId, viewId]);

  // keep the native view glued to this element's rect
  useEffect(() => {
    if (!sessionId || !ref.current) return;
    const push = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      void invoke("view.setBounds", {
        sessionId,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      });
    };
    const ro = new ResizeObserver(push);
    ro.observe(ref.current);
    push();
    return () => ro.disconnect();
  }, [sessionId]);

  useEffect(
    () =>
      on("view.error", ({ sessionId: sid, message }) => {
        if (sid === sessionId) setCrashed(message);
      }),
    [sessionId],
  );

  // close the native view when the slot unmounts
  useEffect(
    () => () => {
      if (sessionId) void invoke("view.close", { sessionId });
    },
    [sessionId],
  );

  return (
    <div className="flex h-64 shrink-0 flex-col border-t border-border">
      <div className="flex items-center justify-between px-4 py-1">
        <span className="text-xs font-medium">
          {packId}:{viewId}
        </span>
        <div className="flex gap-1">
          {crashed && (
            <Button size="sm" variant="secondary" onClick={open}>
              Reload view
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (sessionId) void invoke("view.close", { sessionId });
              onClose();
            }}
          >
            Close
          </Button>
        </div>
      </div>
      {error ? (
        <div className="px-4 py-2 text-xs text-red-400">{error}</div>
      ) : crashed ? (
        <div className="px-4 py-2 text-xs text-amber-400">
          Extension view crashed (contained): {crashed}
        </div>
      ) : (
        <div ref={ref} className="min-h-0 flex-1 bg-black/20" />
      )}
    </div>
  );
}
