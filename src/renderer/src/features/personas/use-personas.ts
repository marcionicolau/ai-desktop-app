// Hook over the persona.*/snippet.* RPC surface (feature 006).
import { useCallback, useEffect, useState } from "react";
import type { Persona, Snippet } from "@shared/types";
import { invoke } from "@/lib/rpc";

export function usePersonas() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [snippets, setSnippets] = useState<Snippet[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([
        invoke("persona.list", {}),
        invoke("snippet.list", {}),
      ]);
      setPersonas(p.personas);
      setSnippets(s.snippets);
    } catch {
      // best-effort (pre-window bootstrap)
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upsert = useCallback(
    async (persona: Persona) => {
      const r = await invoke("persona.upsert", { persona });
      void refresh();
      return r;
    },
    [refresh],
  );
  const remove = useCallback(
    async (name: string) => {
      const r = await invoke("persona.delete", { name });
      void refresh();
      return r;
    },
    [refresh],
  );
  const usage = useCallback(
    (name: string) => invoke("persona.usage", { name }),
    [],
  );
  const upsertSnippet = useCallback(
    async (snippet: Snippet) => {
      const r = await invoke("snippet.upsert", { snippet });
      void refresh();
      return r;
    },
    [refresh],
  );
  const removeSnippet = useCallback(
    async (name: string) => {
      await invoke("snippet.delete", { name });
      void refresh();
    },
    [refresh],
  );

  return {
    personas,
    snippets,
    refresh,
    upsert,
    remove,
    usage,
    upsertSnippet,
    removeSnippet,
  };
}
