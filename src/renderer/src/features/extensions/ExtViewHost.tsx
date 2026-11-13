// feature 017 (US4): host slot for an extension BrowserView. The native
// view is a window-level child positioned over this div — a ResizeObserver
// pushes bounds via view.setBounds (FR-013). A view.error shows a contained
// crash state with reload (re-open), never taking the host down (FR-016).
// feature 019: `visible` parks the session when a tab is hidden
// (view.setVisible), `bare` drops the header chrome for top-level tabs,
// and sessions open lazily on first visible=true (spec A8).
import { useEffect, useRef, useState } from "react";
import { invoke, on } from "@/lib/rpc";
import { Button } from "@/components/ui/button";

interface Props {
  packId: string;
  viewId: string;
  slot?: "tab" | "panel";
  visible?: boolean;
  bare?: boolean;
  onCrash?: () => void;
  onRecovered?: () => void;
  onClose: () => void;
}

export function ExtViewHost({ packId, viewId, slot = "panel", visible = true, bare = false, onCrash, onRecovered, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [crashed, setCrashed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    opened.current = true;
    // spawn at the slot's measured rect so the native view never flashes at
    // BrowserView's default 800x600@0,0 frame (covers the tab bar)
    const r = ref.current?.getBoundingClientRect();
    const rect = r && r.width > 0 && r.height > 0
      ? { x: r.x, y: r.y, width: r.width, height: r.height }
      : undefined;
    void invoke("view.open", { packId, viewId, slot, rect })
      .then((res) => {
        const hadCrash = crashed !== null;
        setSessionId(res.sessionId);
        setCrashed(null);
        if (hadCrash) onRecovered?.();
      })
      .catch((e: Error) => setError(e.message));
  };
  // lazy-open: session starts on first visible=true, not at mount (A8)
  useEffect(() => {
    if (visible && !opened.current) open();
  }, [visible, packId, viewId]);

  // keep the native view glued to this element's rect while visible
  useEffect(() => {
    if (!sessionId || !ref.current || !visible) return;
    const push = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      void invoke("view.setBounds", {
        sessionId,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      });
    };
    const ro = new ResizeObserver(push);
    ro.observe(ref.current);
    push();
    return () => ro.disconnect();
  }, [sessionId, visible]);

  // park/restore the native view on visibility flips
  useEffect(() => {
    if (sessionId) void invoke("view.setVisible", { sessionId, visible });
  }, [sessionId, visible]);

  useEffect(
    () =>
      on("view.error", ({ sessionId: sid, message }) => {
        if (sid === sessionId) {
          setCrashed(message);
          onCrash?.();
        }
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
    <div
      className={
        slot === "tab"
          ? "flex min-h-0 flex-1 flex-col"
          : "flex h-64 shrink-0 flex-col border-t border-border"
      }
      hidden={!visible}
    >
      {!bare && (
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
      )}
      {error ? (
        <div className="px-4 py-2 text-xs text-destructive">{error}</div>
      ) : crashed ? (
        <div className="px-4 py-2 text-xs text-warning">
          Extension view crashed (contained): {crashed}
          <Button size="sm" variant="secondary" className="ml-2" onClick={open}>
            Reload view
          </Button>
        </div>
      ) : (
        <div ref={ref} className="min-h-0 flex-1 bg-muted" />
      )}
    </div>
  );
}
