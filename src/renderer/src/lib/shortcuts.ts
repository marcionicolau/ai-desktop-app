// feature 026 (FR-010): global key handling driven by the action registry.
import { useEffect, useRef } from "react";
import {
  actionForKey,
  isMacPlatform,
  type ActionEntry,
} from "@/lib/actions";

// a modal confirmation owns the keyboard; nothing global fires behind it
const modalConfirmOpen = () =>
  typeof document !== "undefined" && document.querySelector('[role="alertdialog"]') !== null;

export function useGlobalShortcuts(actions: ActionEntry[], onBlocked?: (reason: string) => void) {
  const ref = useRef(actions);
  ref.current = actions;
  const blocked = useRef(onBlocked);
  blocked.current = onBlocked;
  useEffect(() => {
    const mac = isMacPlatform();
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return;
      const a = actionForKey(e, ref.current, mac);
      if (!a) return;
      if (modalConfirmOpen()) return;
      e.preventDefault();
      const avail = a.available();
      if (!avail.ok) {
        blocked.current?.(avail.reason);
        return;
      }
      a.run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
