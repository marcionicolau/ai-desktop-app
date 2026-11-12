// Full-library backup export/restore (feature 008, US3). Both actions go
// through typed RPC + native pickers; cancelled pickers are silent.
import { useState } from "react";
import { invoke } from "@/lib/rpc";
import { Button } from "@/components/ui/button";

export function DataPanel() {
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setNotice(null);
    try {
      setNotice(await fn());
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-border bg-muted/40 px-4 py-3">
      <div className="mx-auto flex max-w-2xl items-center gap-2">
        <span className="text-xs text-muted-foreground">Backup</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const r = await invoke("backup.export", {}, { maxRequestTime: Infinity });
              return r.path ? `Backup saved to ${r.path}` : "Export cancelled.";
            })
          }
        >
          Export backup…
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const r = await invoke("backup.import", {}, { maxRequestTime: Infinity });
              return r.imported === null
                ? "Restore cancelled."
                : `Restored ${r.imported} conversation${r.imported === 1 ? "" : "s"}.`;
            })
          }
        >
          Restore backup…
        </Button>
        {notice && (
          <span className="truncate text-xs text-muted-foreground" title={notice}>
            {notice}
          </span>
        )}
      </div>
    </div>
  );
}
