// feature 019: workspace tab hook — pure model lives in tab-model.ts;
// this wires it to extension.scan + extension.changed. Selection is
// session-only React state.
import { useEffect, useState } from "react";
import type { InstalledPackView } from "@shared/types";
import { invoke, on } from "@/lib/rpc";
import { CHAT_TAB, deriveTabs, reconcile, type TabState } from "./tab-model";

export function useWorkspaceTabs() {
  const [state, setState] = useState<TabState>({ tabs: [CHAT_TAB], selectedId: "chat" });

  useEffect(() => {
    const scan = () =>
      invoke("extension.scan", {}).then((r) => r.packs as InstalledPackView[]);
    // initial scan seeds the baseline — restored tabs are never "new"
    void scan().then((packs) =>
      setState({ tabs: deriveTabs(packs), selectedId: "chat" }),
    );
    return on("extension.changed", () => {
      void scan().then((packs) => setState((prev) => reconcile(prev, packs)));
    });
  }, []);

  const select = (id: string) =>
    setState((s) => (s.tabs.some((t) => t.id === id) ? { ...s, selectedId: id } : s));

  const focusView = (packId: string, viewId: string) => select(`${packId}:${viewId}`);

  return { ...state, select, focusView };
}
