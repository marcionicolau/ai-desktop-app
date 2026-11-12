// feature 013 (US1/US2): discrete update notice — version + changelog,
// background progress, restart-to-apply. Apply is always user-explicit
// (FR-005); the banner hides while a generation runs so a restart
// prompt never interrupts a turn.
import { useEffect, useState } from "react";
import { invoke, on } from "@/lib/rpc";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { UpdateView } from "@shared/types";

export function UpdateBanner({ generating }: { generating: boolean }) {
  const [view, setView] = useState<UpdateView | null>(null);
  const [installerPath, setInstallerPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    void invoke("update.state", {}).then(setView).catch(() => {});
    return on("update.status", setView);
  }, []);

  if (
    !view ||
    dismissed ||
    generating ||
    (view.status !== "available" &&
      view.status !== "downloading" &&
      view.status !== "ready")
  ) {
    return null;
  }

  const rel = view.release;
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      // errors surface via update.status; keep the banner honest but quiet
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-border bg-muted/60 px-4 py-2 text-xs">
      <div className="mx-auto flex max-w-2xl flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">
            {view.channelSwitch ? (
              <>
                {rel?.channel} channel has v{rel?.version} — install it to
                switch channels
              </>
            ) : view.status === "ready" ? (
              <>Update to v{rel?.version ?? view.current.version} is ready</>
            ) : view.status === "downloading" ? (
              <>
                Downloading v{rel?.version}…{" "}
                {view.progress ? `${view.progress.percent}%` : ""}
              </>
            ) : (
              <>Update available: v{rel?.version}</>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {view.status === "available" && !view.channelSwitch && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void run(() => invoke("update.download", {}))}
              >
                Download
              </Button>
            )}
            {view.status === "available" && view.channelSwitch && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const r = await invoke("update.download", {});
                    if (r.installerPath) setInstallerPath(r.installerPath);
                  })
                }
              >
                Switch to {rel?.channel} v{rel?.version}
              </Button>
            )}
            {view.status === "ready" && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void run(() => invoke("update.apply", {}))}
              >
                Restart to update
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDismissed(true)}
            >
              Later
            </Button>
          </span>
        </div>
        {view.status === "downloading" && view.progress && (
          <Progress value={view.progress.percent} className="h-1.5" />
        )}
        {rel?.changelog && view.status === "available" && (
          <p className="line-clamp-2 text-muted-foreground/80 whitespace-pre-line">
            {rel.changelog}
          </p>
        )}
        {installerPath && (
          <p className="text-muted-foreground/80">
            Installer saved to {installerPath} — run it to switch to the{" "}
            {rel?.channel} channel. Your data is untouched.
          </p>
        )}
      </div>
    </div>
  );
}
