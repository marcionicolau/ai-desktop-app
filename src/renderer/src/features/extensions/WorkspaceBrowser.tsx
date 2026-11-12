// feature 017 (US2): browse an enabled pack's contributions — skills with
// spec bodies, pipelines/agents (runnable via run.start), commands mapped
// to run.start (T024 remediation), views openable via view.open.
import { useEffect, useState } from "react";
import type { PackContributionsView } from "@shared/types";
import { invoke } from "@/lib/rpc";
import { Button } from "@/components/ui/button";

interface Props {
  packId: string;
  onRunStarted: (runId: string) => void;
  onOpenView: (packId: string, viewId: string) => void;
}

export function WorkspaceBrowser({ packId, onRunStarted, onOpenView }: Props) {
  const [c, setC] = useState<PackContributionsView | null>(null);
  const [spec, setSpec] = useState<{ id: string; body: string } | null>(null);
  const [objective, setObjective] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setC(null);
    setSpec(null);
    void invoke("pack.contributions", { packId })
      .then(setC)
      .catch((e: Error) => setError(e.message));
  }, [packId]);

  const start = (kind: "pipeline" | "agent", id: string, params?: Record<string, unknown>) => {
    void invoke("run.start", {
      packId,
      target: { kind, id },
      objective: objective || id,
      params,
    })
      .then((r) => onRunStarted(r.runId))
      .catch((e: Error) => setError(e.message));
  };

  const readSpec = (id: string) => {
    void invoke("pack.readSpec", { contributionId: id }).then((r) =>
      setSpec({ id, body: r.body }),
    );
  };

  if (error) return <div className="px-4 py-2 text-xs text-red-400">{error}</div>;
  if (!c) return <div className="px-4 py-2 text-xs text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-2 px-4 py-2 text-sm" data-testid="workspace-browser">
      <input
        value={objective}
        onChange={(e) => setObjective(e.target.value)}
        placeholder="Run objective…"
        className="h-7 w-full rounded border border-border bg-background px-2 text-xs"
        aria-label="Run objective"
      />
      {c.commands.length > 0 && (
        <section>
          <h3 className="text-xs font-medium">Commands</h3>
          {c.commands.map((cmd) => (
            <div key={cmd.id} className="flex items-center justify-between py-0.5">
              <span className="text-xs" title={cmd.description}>{cmd.title}</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  start(
                    cmd.run.pipeline ? "pipeline" : "agent",
                    cmd.run.pipeline ?? cmd.run.agent ?? "",
                    cmd.run.params,
                  )
                }
              >
                Run
              </Button>
            </div>
          ))}
        </section>
      )}
      {c.pipelines.length > 0 && (
        <section>
          <h3 className="text-xs font-medium">Pipelines</h3>
          {c.pipelines.map((p) => (
            <div key={p.id} className="flex items-center justify-between py-0.5">
              <span className="text-xs" title={p.description}>
                {p.name} <span className="text-muted-foreground">({p.steps.length} steps)</span>
              </span>
              <Button size="sm" variant="secondary" onClick={() => start("pipeline", p.name)}>
                Run
              </Button>
            </div>
          ))}
        </section>
      )}
      {c.agents.length > 0 && (
        <section>
          <h3 className="text-xs font-medium">Agents</h3>
          {c.agents.map((a) => (
            <div key={a.id} className="flex items-center justify-between py-0.5">
              <span className="text-xs">
                {a.name} <span className="text-muted-foreground">({a.kind})</span>
              </span>
              <Button size="sm" variant="secondary" onClick={() => start("agent", a.name)}>
                Run
              </Button>
            </div>
          ))}
        </section>
      )}
      {c.skills.length > 0 && (
        <section>
          <h3 className="text-xs font-medium">Skills</h3>
          {c.skills.map((s) => (
            <div key={s.id} className="py-0.5">
              <button
                className="text-xs underline-offset-2 hover:underline"
                onClick={() => readSpec(s.id)}
              >
                {s.name}
              </button>
              <span className="ml-2 text-xs text-muted-foreground">{s.runtime}</span>
            </div>
          ))}
        </section>
      )}
      {c.views.length > 0 && (
        <section>
          <h3 className="text-xs font-medium">Views</h3>
          {c.views.map((v) => (
            <div key={v.id} className="flex items-center justify-between py-0.5">
              <span className="text-xs">{v.title}</span>
              <Button size="sm" variant="secondary" onClick={() => onOpenView(packId, v.id)}>
                Open
              </Button>
            </div>
          ))}
        </section>
      )}
      {spec && (
        <pre className="max-h-60 overflow-auto rounded bg-muted p-2 text-[11px]">
          {spec.id}
          {"\n\n"}
          {spec.body}
        </pre>
      )}
    </div>
  );
}
