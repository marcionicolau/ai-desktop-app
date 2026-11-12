// feature 017 (US3): run monitor — history list + selected-run trace with
// live run.event/run.status updates and cancellation (FR-010/FR-011).
// T050: per-step input/output rendering and artifact values.
// feature 021: steps rendered via ai-elements Task/Queue/Subagent recipes.
import { useEffect, useState } from "react";
import type { RunRecord, RunSummary } from "@shared/types";
import { invoke, on } from "@/lib/rpc";
import { Button } from "@/components/ui/button";
import { Queue, Subagent, Task, type TaskStatus } from "@/components/ai/task";
import { ToolCallSection } from "@/components/ai/tool-call";
import { cn } from "@/lib/utils";

const STEP_STATUS: Record<string, TaskStatus> = {
  queued: "queued",
  running: "running",
  completed: "completed",
  failed: "failed",
  skipped: "skipped",
  pending: "queued",
};

const RUN_DOT: Record<string, string> = {
  failed: "text-destructive",
  completed: "text-success",
  running: "text-warning",
  queued: "text-muted-foreground",
};

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
        <ul className="max-h-56 w-64 shrink-0 space-y-0.5 overflow-auto">
          {runs.length === 0 && (
            <li className="text-xs text-muted-foreground">No runs yet.</li>
          )}
          {runs.toReversed().map((r) => (
            <li key={r.id}>
              <button
                className={cn(
                  "w-full truncate rounded px-1 text-left text-xs hover:bg-accent",
                  selected?.id === r.id && "bg-accent font-medium",
                )}
                onClick={() => open(r.id)}
              >
                <span className={RUN_DOT[r.status] ?? "text-muted-foreground"}>
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
                <span className="text-destructive">
                  {selected.error.code}: {selected.error.message}
                  {selected.error.path ? ` (${selected.error.path})` : ""}
                </span>
              )}
            </div>
            <Queue
              className="max-h-56 overflow-auto rounded border border-border bg-card p-2 text-[11px]"
              data-testid="trace-view"
            >
              <Subagent
                name={`${selected.target.id} — ${selected.objective.slice(0, 48)}`}
                status={
                  selected.status === "completed"
                    ? "completed"
                    : selected.status === "failed"
                      ? "failed"
                      : "running"
                }
                defaultOpen
                last
              >
                {selected.trace.map((t, i) => (
                  <Task
                    key={t.seq}
                    last={i === selected.trace.length - 1}
                    title={
                      <>
                        <span className="text-muted-foreground">#{t.seq}</span>{" "}
                        {t.kind} {t.path}
                      </>
                    }
                    status={STEP_STATUS[t.status] ?? "queued"}
                  >
                    {(t.input !== undefined || t.output !== undefined) && (
                      <div className="mt-0.5 space-y-0.5 font-mono text-[10px]">
                        {t.input !== undefined && (
                          <div className="text-muted-foreground">
                            in: {JSON.stringify(t.input).slice(0, 200)}
                          </div>
                        )}
                        {t.output !== undefined && (
                          <div>out: {JSON.stringify(t.output).slice(0, 200)}</div>
                        )}
                      </div>
                    )}
                  </Task>
                ))}
              </Subagent>
            </Queue>
            {selected.artifacts.length > 0 && (
              <ToolCallSection title="artifacts" defaultOpen className="mt-1 text-xs">
                <div className="space-y-0.5" data-testid="artifact-values">
                  {selected.artifacts.map((a) => (
                    <div key={`${a.stepId}:${a.name}`}>
                      <span className="font-medium">{a.name}</span>
                      <span className="text-muted-foreground"> ({a.type})</span>:{" "}
                      {typeof a.value === "string"
                        ? a.value.slice(0, 300)
                        : JSON.stringify(a.value).slice(0, 300)}
                    </div>
                  ))}
                </div>
              </ToolCallSection>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
