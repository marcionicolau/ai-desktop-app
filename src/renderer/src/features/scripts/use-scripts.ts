// feature 023 (T027): hook over the script.* / runtime.* RPC surface
// plus script.run + session.state event subscriptions.
import { useCallback, useEffect, useState } from "react";
import type {
  RuntimeStatus,
  ScriptListItem,
  ScriptRunRecord,
  ScriptRuntimeKind,
  ScriptUpsertParams,
} from "@shared/types";
import { invoke, on } from "@/lib/rpc";

export function useScripts() {
  const [scripts, setScripts] = useState<ScriptListItem[]>([]);
  const [runtimes, setRuntimes] = useState<RuntimeStatus[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        invoke("script.list", {}),
        invoke("runtime.list", {}),
      ]);
      setScripts(s.scripts);
      setRuntimes(r.runtimes);
    } catch {
      // best-effort (pre-window bootstrap)
    }
  }, []);

  useEffect(() => {
    void refresh();
    // session.state pushes update the runtime badges live
    const off = on("session.state", (e) => {
      setRuntimes((prev) =>
        prev.map((r) =>
          r.kind === e.runtime
            ? {
                ...r,
                session: {
                  state: e.state,
                  calls: r.session?.calls ?? 0,
                  restartCount: e.restartCount,
                },
              }
            : r,
        ),
      );
    });
    return off;
  }, [refresh]);

  const upsert = useCallback(
    async (params: ScriptUpsertParams) => {
      const r = await invoke("script.upsert", params);
      void refresh();
      return r.entry;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await invoke("script.delete", { id });
      void refresh();
    },
    [refresh],
  );

  const setEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      await invoke("script.enable", { id, enabled });
      void refresh();
    },
    [refresh],
  );

  const run = useCallback(
    (id: string, args?: Record<string, unknown>, timeoutMs?: number) =>
      invoke("script.run", { id, args, timeoutMs }) as Promise<ScriptRunRecord>,
    [],
  );

  const resetRuntime = useCallback(
    async (kind: ScriptRuntimeKind) => {
      await invoke("runtime.reset", { kind });
      void refresh();
    },
    [refresh],
  );

  const detectRuntime = useCallback(
    async (kind: ScriptRuntimeKind) => {
      const r = await invoke("runtime.detect", { kind });
      void refresh();
      return r.path;
    },
    [refresh],
  );

  return {
    scripts,
    runtimes,
    refresh,
    upsert,
    remove,
    setEnabled,
    run,
    resetRuntime,
    detectRuntime,
  };
}
