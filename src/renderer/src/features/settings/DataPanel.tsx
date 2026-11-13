// Full-library backup export/restore (feature 008, US3). Both actions go
// through typed RPC + native pickers; cancelled pickers are silent.
import { confirm } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { IconSpinner } from "@/components/icons";
import { useState } from "react";
import { invoke } from "@/lib/rpc";
import { Button } from "@/components/ui/button";

export function DataPanel() {
  const [busy, setBusy] = useState<"export" | "restore" | null>(null);

  // FR-001/FR-002: progress in the triggering button, result as a toast,
  // failures with a Retry action; "cancelled" is informational, not an error
  const run = async (which: "export" | "restore", fn: () => Promise<string>) => {
    setBusy(which);
    try {
      const msg = await fn();
      if (msg.endsWith("cancelled.")) notify.info(msg);
      else notify.success(msg);
    } catch (e) {
      notify.error(which === "export" ? "Backup export failed" : "Backup restore failed", {
        description: e instanceof Error ? e.message : String(e),
        action: { label: "Retry", run: () => void run(which, fn) },
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id="settings-data" aria-labelledby="data-heading" className="border-b border-border bg-muted/40 px-4 py-3">
      <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-2">
        <h2 id="data-heading" className="text-xs font-medium text-muted-foreground">Backup</h2>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null}
          aria-busy={busy === "export"}
          onClick={() =>
            void run("export", async () => {
              const r = await invoke("backup.export", {}, { maxRequestTime: Infinity });
              return r.path ? `Backup saved to ${r.path}` : "Export cancelled.";
            })
          }
        >
          {busy === "export" && <IconSpinner className="animate-spin" aria-hidden="true" />}
          Export backup…
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null}
          aria-busy={busy === "restore"}
          onClick={() =>
            void run("restore", async () => {
              const ok = await confirm({
                title: "Restore backup",
                itemName: "the backup file you choose",
                consequence:
                  "Its conversations are added as new chats; settings and role bindings from the file replace your current ones.",
                confirmLabel: "Choose file…",
                destructive: false,
              });
              if (!ok) return "Restore cancelled.";
              const r = await invoke("backup.import", {}, { maxRequestTime: Infinity });
              return r.imported === null
                ? "Restore cancelled."
                : `Restored ${r.imported} conversation${r.imported === 1 ? "" : "s"}.`;
            })
          }
        >
          {busy === "restore" && <IconSpinner className="animate-spin" aria-hidden="true" />}
          Restore backup…
        </Button>
      </div>
    </section>
  );
}
