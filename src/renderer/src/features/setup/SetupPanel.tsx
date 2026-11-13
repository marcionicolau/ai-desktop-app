// feature 022: first-run bootstrap progress on the models surface.
// Renders nothing once setup is done/idle — the manual library stays
// fully usable underneath as the fallback path (spec FR-006).
import { useSetup } from "./use-setup";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

function formatBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)} GB`;
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(0)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

export function SetupPanel() {
  const { state, retry } = useSetup();
  const { phase } = state;
  if (phase === "idle" || phase === "done" || phase === "checking") return null;

  if (phase === "error") {
    return (
      <div className="border-b border-border px-6 py-4">
        <p className="text-sm font-medium">Couldn't download the default model</p>
        <p className="mt-1 text-xs text-muted-foreground">{state.error}</p>
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" onClick={retry}>
            Retry download
          </Button>
          <span className="text-xs text-muted-foreground">
            or download a model manually below
          </span>
        </div>
      </div>
    );
  }

  const pct =
    state.totalBytes && state.totalBytes > 0
      ? Math.round((state.downloadedBytes / state.totalBytes) * 100)
      : null;
  return (
    <div className="border-b border-border px-6 py-4">
      <p className="text-sm font-medium">
        {phase === "loading" ? "Loading model…" : "Downloading your first model…"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {state.fileName}
        {state.totalBytes
          ? ` — ${formatBytes(state.downloadedBytes)} of ${formatBytes(state.totalBytes)}`
          : ""}
      </p>
      <Progress value={pct ?? 0} className="mt-3" />
      <p className="mt-1 text-xs text-muted-foreground">
        {pct !== null ? `${pct}%` : "Starting…"}
      </p>
    </div>
  );
}
