// Hook over the role.* RPC surface (contracts/rpc.md). Subscribes to
// role.changed so all views share fresh tag state.
import { useCallback, useEffect, useState } from "react";
import type { GenerationParams, RoleRef, RoleView } from "@shared/types";
import { invoke, on } from "@/lib/rpc";

export function useRoles() {
  const [tags, setTags] = useState<RoleView[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await invoke("role.list", {});
      setTags(res.tags);
    } catch {
      // role.list is best-effort (e.g. pre-window bootstrap)
    }
  }, []);

  useEffect(() => {
    void refresh();
    return on("role.changed", () => void refresh());
  }, [refresh]);

  const create = useCallback(
    (input: { name: string; label?: string; description?: string }) =>
      invoke("role.create", input),
    [],
  );
  const update = useCallback(
    (input: {
      name: string;
      label?: string;
      description?: string;
      params?: Partial<GenerationParams> | null;
    }) => invoke("role.update", input),
    [],
  );
  const remove = useCallback(
    (name: string, force?: boolean) => invoke("role.delete", { name, force }),
    [],
  );
  const bind = useCallback(
    (name: string, fileName: string | null) =>
      invoke("role.bind", { name, fileName }),
    [],
  );
  const setFallback = useCallback(
    (name: string, chain: RoleRef[]) =>
      invoke("role.setFallback", { name, chain }),
    [],
  );

  return { tags, refresh, create, update, remove, bind, setFallback };
}
