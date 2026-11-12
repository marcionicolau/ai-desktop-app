// feature 019: workspace tab hook — pure model lives in tab-model.ts;
// this wires it to extension.scan + extension.changed. Selection is
// session-only React state.
import { useEffect, useRef, useState } from "react";
import type { InstalledPackView } from "@shared/types";
import { invoke, on } from "@/lib/rpc";
import { CHAT_TAB, deriveTabs, reconcile, type TabState } from "./tab-model";

export function useWorkspaceTabs() {
  const [state, setState] = useState<TabState>({ tabs: [CHAT_TAB], selectedId: "chat" });
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

  const select = (id: string) =>
    setState((s) => (s.tabs.some((t) => t.id === id) ? { ...s, selectedId: id } : s));

  const focusView = (packId: string, viewId: string) => select(`${packId}:${viewId}`);

  return { ...state, select, focusView };
}
