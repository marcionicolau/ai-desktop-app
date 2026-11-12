// feature 017 (US3): run monitor — history list + selected-run trace with
// live run.event/run.status updates and cancellation (FR-010/FR-011).
import { useEffect, useState } from "react";
import type { RunRecord, RunSummary } from "@shared/types";
import { invoke, on } from "@/lib/rpc";
import { Button } from "@/components/ui/button";

export function RunView({ focusRunId }: { focusRunId: string | null }) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selected, setSelected] = useState<RunRecord | null>(null);

  const refresh = () => {
    void invoke("run.list", {}).then((r) => setRuns(r.runs));
  };
  useEffect(refresh, []);

  const open = (runId: string) => {
    void invoke("run.get", { runId }).then((r) => setSelected(r.run));
  };
  useEffect(() => {
    if (focusRunId) open(focusRunId);
  }, [focusRunId]);

  useEffect(
    () =>
      on("run.event", ({ runId, entry }) => {
        setSelected((s) =>
          s?.id === runId ? { ...s, trace: [...s.trace, entry] } : s,
        );
      }),
    [],
  );
  useEffect(
    () =>
      on("run.status", ({ runId, status, error }) => {
        setSelected((s) =>
          s?.id === runId ? { ...s, status, error } : s,
        );
        refresh();
      }),
    [],
  );

  const active = selected && (selected.status === "running" || selected.status === "queued");

  return (
    <div className="border-t border-border px-4 py-2 text-sm" data-testid="run-view">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium">Runs</span>
        <Button size="sm" variant="ghost" onClick={refresh}>
          Refresh
        </Button>
      </div>
      <div className="flex gap-3">
        <ul className="max-h-40 w-64 shrink-0 space-y-0.5 overflow-auto">
          {runs.length === 0 && (
            <li className="text-xs text-muted-foreground">No runs yet.</li>
          )}
          {runs.toReversed().map((r) => (
            <li key={r.id}>
              <button
                className={`w-full truncate text-left text-xs ${
                  selected?.id === r.id ? "font-medium" : ""
                }`}
                onClick={() => open(r.id)}
              >
                <span
                  className={
                    r.status === "failed"
                      ? "text-red-400"
                      : r.status === "completed"
                        ? "text-green-400"
                        : "text-amber-400"
                  }
                >
                  ●
                </span>{" "}
                {r.target.id} — {r.objective.slice(0, 40)}
              </button>
            </li>
          ))}
        </ul>
        {selected && (
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2 text-xs">
              <span className="font-medium">{selected.id}</span>
              <span className="text-muted-foreground">{selected.status}</span>
              {active && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void invoke("run.cancel", { runId: selected.id })}
                >
                  Cancel
                </Button>
              )}
              {selected.error && (
                <span className="text-red-400">
                  {selected.error.code}: {selected.error.message}
                  {selected.error.path ? ` (${selected.error.path})` : ""}
                </span>
              )}
            </div>
            <ul className="max-h-40 space-y-0.5 overflow-auto rounded bg-muted p-2 font-mono text-[11px]">
              {selected.trace.map((t) => (
                <li key={t.seq}>
                  <span className="text-muted-foreground">#{t.seq}</span> {t.kind}{" "}
                  {t.path} <span className="text-muted-foreground">{t.status}</span>
                </li>
              ))}
            </ul>
            {selected.artifacts.length > 0 && (
              <div className="mt-1 text-xs">
                Artifacts: {selected.artifacts.map((a) => a.name).join(", ")}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
