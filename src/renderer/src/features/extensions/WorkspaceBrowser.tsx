// feature 017 (US2): browse an enabled pack's contributions — skills with
// spec bodies, pipelines/agents (runnable via run.start), commands mapped
// to run.start (T024 remediation), views openable via view.open.
// T049: structured detail panes — SkillDetail (typed ports/params/guidance),
// PipelineDetail (step DAG + bindings), AgentTree (recursive hierarchy).
import { useEffect, useState } from "react";
import type {
  AgentView,
  PackContributionsView,
  PipelineView,
  SkillView,
} from "@shared/types";
import { invoke } from "@/lib/rpc";
import { Button } from "@/components/ui/button";

interface Props {
  packId: string;
  onRunStarted: (runId: string) => void;
  onOpenView: (packId: string, viewId: string, slot: "tab" | "panel") => void;
}

type Selection =
  | { kind: "skill"; item: SkillView }
  | { kind: "pipeline"; item: PipelineView }
  | { kind: "agent"; item: AgentView };

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-32 overflow-auto rounded bg-muted p-1.5 font-mono text-[10px]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

const ports = (label: string, rec: Record<string, { type?: string; description?: string }>) =>
  Object.keys(rec).length > 0 ? (
    <div>
      <div className="text-[10px] font-medium uppercase text-muted-foreground">{label}</div>
      <ul className="space-y-0.5">
        {Object.entries(rec).map(([name, d]) => (
          <li key={name} className="text-xs">
            <span className="font-mono">{name}</span>
            <span className="text-muted-foreground">: {d.type ?? "any"}</span>
            {d.description && (
              <span className="text-muted-foreground"> — {d.description}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  ) : null;

function SkillDetail({ skill }: { skill: SkillView }) {
  const [body, setBody] = useState<string | null>(null);
  useEffect(() => {
    setBody(null);
    void invoke("pack.readSpec", { contributionId: skill.id }).then((r) =>
      setBody(r.body),
    );
  }, [skill.id]);
  return (
    <div className="space-y-1.5" data-testid="skill-detail">
      <div className="text-xs font-medium">
        {skill.name} <span className="text-muted-foreground">({skill.runtime})</span>
      </div>
      {skill.description && <p className="text-xs text-muted-foreground">{skill.description}</p>}
      {ports("Inputs", skill.inputs)}
      {ports("Outputs", skill.outputs)}
      {Object.keys(skill.params).length > 0 && (
        <div>
          <div className="text-[10px] font-medium uppercase text-muted-foreground">Params</div>
          <JsonBlock value={skill.params} />
        </div>
      )}
      {(skill.guidance.whenToUse || skill.guidance.interpreting || skill.guidance.mistakes) && (
        <div className="space-y-0.5">
          <div className="text-[10px] font-medium uppercase text-muted-foreground">Guidance</div>
          {skill.guidance.whenToUse && (
            <p className="text-xs"><span className="text-muted-foreground">When: </span>{skill.guidance.whenToUse}</p>
          )}
          {skill.guidance.interpreting && (
            <p className="text-xs"><span className="text-muted-foreground">Interpret: </span>{skill.guidance.interpreting}</p>
          )}
          {skill.guidance.mistakes && (
            <p className="text-xs"><span className="text-muted-foreground">Pitfalls: </span>{skill.guidance.mistakes}</p>
          )}
        </div>
      )}
      {body && (
        <div>
          <div className="text-[10px] font-medium uppercase text-muted-foreground">Spec body</div>
          <pre className="max-h-48 overflow-auto rounded bg-muted p-1.5 font-mono text-[10px]">
            {body}
          </pre>
        </div>
      )}
    </div>
  );
}

function PipelineDetail({ pipeline }: { pipeline: PipelineView }) {
  return (
    <div className="space-y-1" data-testid="pipeline-detail">
      <div className="text-xs font-medium">{pipeline.name}</div>
      {pipeline.description && (
        <p className="text-xs text-muted-foreground">{pipeline.description}</p>
      )}
      <ol className="space-y-1">
        {pipeline.steps.map((s, i) => (
          <li key={s.id} className="rounded bg-muted p-1.5">
            <div className="text-xs">
              <span className="text-muted-foreground">{i + 1}.</span>{" "}
              <span className="font-mono">{s.id}</span>{" "}
              <span className="text-muted-foreground">→ {s.uses}</span>
            </div>
            {s.inputs && (
              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                in: {JSON.stringify(s.inputs)}
              </div>
            )}
            {s.params && (
              <div className="font-mono text-[10px] text-muted-foreground">
                params: {JSON.stringify(s.params)}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function AgentNode({ agent, depth }: { agent: AgentView; depth: number }) {
  return (
    <li style={{ marginLeft: depth * 12 }}>
      <div className="text-xs">
        <span className="font-mono">{agent.name}</span>{" "}
        <span className="text-muted-foreground">
          {agent.kind}
          {agent.model ? ` · ${agent.model}` : ""}
          {agent.pipeline ? ` · →${agent.pipeline}` : ""}
          {agent.fallback ? ` · fb:${agent.fallback}` : ""}
        </span>
      </div>
      {agent.children.length > 0 && (
        <ul className="border-l border-border pl-1">
          {agent.children.map((ch) => (
            <AgentNode key={ch.id} agent={ch} depth={0} />
          ))}
        </ul>
      )}
    </li>
  );
}

function AgentTree({ agent }: { agent: AgentView }) {
  return (
    <div className="space-y-1" data-testid="agent-tree">
      <div className="text-xs font-medium">{agent.name}</div>
      <ul className="rounded bg-muted p-1.5">
        <AgentNode agent={agent} depth={0} />
      </ul>
    </div>
  );
}

export function WorkspaceBrowser({ packId, onRunStarted, onOpenView }: Props) {
  const [c, setC] = useState<PackContributionsView | null>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  const [objective, setObjective] = useState("");
  const [paramVals, setParamVals] = useState<Record<string, Record<string, string>>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setC(null);
    setSel(null);
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
          {c.pipelines.map((p) => {
            const declared = Object.keys(p.inputs ?? {});
            const vals = paramVals[p.id] ?? {};
            const runParams = declared.length
              ? Object.fromEntries(declared.map((k) => [k, vals[k] ?? ""]))
              : undefined;
            return (
              <div key={p.id} className="py-0.5">
                <div className="flex items-center justify-between">
                  <button
                    className="text-xs underline-offset-2 hover:underline"
                    title={p.description}
                    onClick={() => setSel({ kind: "pipeline", item: p })}
                  >
                    {p.name} <span className="text-muted-foreground">({p.steps.length} steps)</span>
                  </button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => start("pipeline", p.name, runParams)}
                  >
                    Run
                  </Button>
                </div>
                {declared.map((name) => (
                  <input
                    key={name}
                    value={vals[name] ?? ""}
                    onChange={(e) =>
                      setParamVals((m) => ({
                        ...m,
                        [p.id]: { ...m[p.id], [name]: e.target.value },
                      }))
                    }
                    placeholder={`${name} (${p.inputs[name]?.type ?? "text"})`}
                    className="mt-1 h-7 w-full rounded border border-border bg-background px-2 text-xs"
                    aria-label={`${p.name} input ${name}`}
                  />
                ))}
              </div>
            );
          })}
        </section>
      )}
      {c.agents.length > 0 && (
        <section>
          <h3 className="text-xs font-medium">Agents</h3>
          {c.agents.map((a) => (
            <div key={a.id} className="flex items-center justify-between py-0.5">
              <button
                className="text-xs underline-offset-2 hover:underline"
                onClick={() => setSel({ kind: "agent", item: a })}
              >
                {a.name} <span className="text-muted-foreground">({a.kind})</span>
              </button>
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
                onClick={() => setSel({ kind: "skill", item: s })}
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
              <span className="text-xs">
                {v.title}
                {v.slot === "tab" && (
                  <span className="ml-1 text-muted-foreground">(tab)</span>
                )}
              </span>
              <Button size="sm" variant="secondary" onClick={() => onOpenView(packId, v.id, v.slot)}>
                Open
              </Button>
            </div>
          ))}
        </section>
      )}
      {sel && (
        <section className="rounded border border-border p-2">
          {sel.kind === "skill" && <SkillDetail skill={sel.item} />}
          {sel.kind === "pipeline" && <PipelineDetail pipeline={sel.item} />}
          {sel.kind === "agent" && <AgentTree agent={sel.item} />}
        </section>
      )}
    </div>
  );
}
