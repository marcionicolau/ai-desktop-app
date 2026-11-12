// feature 019: workspace tab hook — pure model lives in tab-model.ts;
// this wires it to extension.scan + extension.changed. Selection is
// session-only React state. Also owns the per-item crash badge set —
// sidebar chrome shows it, ExtViewHost shows the contained error.
import { useEffect, useRef, useState } from "react";
import type { InstalledPackView } from "@shared/types";
import { invoke, on } from "@/lib/rpc";
import { CHAT_TAB, deriveTabs, reconcile, type TabState } from "./tab-model";

export function useWorkspaceItems() {
  const [state, setState] = useState<TabState>({ tabs: [CHAT_TAB], selectedId: "chat" });
  const [crashed, setCrashed] = useState<ReadonlySet<string>>(new Set());
  const seeded = useRef(false);

  useEffect(() => {
    const scan = () =>
      invoke("extension.scan", {}).then((r) => r.packs as InstalledPackView[]);
    // the first scan result to land seeds the baseline — restored tabs are
    // never "new" (FR-006); only changes after the baseline reconcile.
    const baseline = (packs: InstalledPackView[]) => {
      seeded.current = true;
      setState({ tabs: deriveTabs(packs), selectedId: "chat" });
    };
    void scan().then(baseline);
    return on("extension.changed", () => {
      void scan().then((packs) =>
        seeded.current ? setState((prev) => reconcile(prev, packs)) : baseline(packs),
      );
    });
  }, []);

  // drop badges for items that vanished — a re-enabled pack starts clean
  useEffect(() => {
    const live = new Set(state.tabs.map((t) => t.id));
    setCrashed((s) => {
      const kept = [...s].filter((id) => live.has(id));
      return kept.length === s.size ? s : new Set(kept);
    });
  }, [state.tabs]);

  const select = (id: string) =>
    setState((s) => (s.tabs.some((t) => t.id === id) ? { ...s, selectedId: id } : s));

  const focusView = (packId: string, viewId: string) => select(`${packId}:${viewId}`);

  const markCrashed = (id: string) =>
    setCrashed((s) => (s.has(id) ? s : new Set(s).add(id)));

  const clearCrashed = (id: string) =>
    setCrashed((s) => {
      if (!s.has(id)) return s;
      const n = new Set(s);
      n.delete(id);
      return n;
    });

  return { ...state, select, focusView, crashed, markCrashed, clearCrashed };
}
