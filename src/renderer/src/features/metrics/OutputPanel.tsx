// feature 016: bottom-docked per-call metrics panel. Sibling of the
// message area inside ChatPage's flex-col — it pushes messages up,
// never overlays (FR-005). The same persisted switch gates recording
// on the bun side (US2); calls while off never arrive.
import { useEffect, useMemo, useState } from "react";
import type { MetricEntry } from "@shared/types";
import { invoke, on } from "@/lib/rpc";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ContextChip } from "@/components/ai/context";

const fmtTime = (ts: string) =>
  new Date(ts).toLocaleTimeString([], { hour12: false });

// role subdivisions: a fallback-served call groups under "fallback"
const groupKey = (e: MetricEntry) => (e.fallback ? "fallback" : e.roleKey);

export function OutputPanel({ open }: { open: boolean }) {
  const [entries, setEntries] = useState<MetricEntry[]>([]);
  const [tab, setTab] = useState<string>("*");
  // fileName → trained context size (model.list is cheap — cached meta)
  const [ctxSizes, setCtxSizes] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!open) return;
    // hydrate on open; live appends arrive via metrics.entry
    void invoke("metrics.list", {}).then((r) => setEntries(r.entries));
    void invoke("model.list", {}).then((r) =>
      setCtxSizes(
        Object.fromEntries(
          r.models
            .filter((m) => m.contextTrain !== null)
            .map((m) => [m.fileName, m.contextTrain!]),
        ),
      ),
    );
    return on("metrics.entry", (e) => setEntries((p) => [...p, e]));
  }, [open]);

  const models = useMemo(
    () => [...new Set(entries.map((e) => e.modelFile))],
    [entries],
  );
  const visible = useMemo(
    () => (tab === "*" ? entries : entries.filter((e) => e.modelFile === tab)),
    [entries, tab],
  );
  // role -> persona -> entries, preserving call order
  const groups = useMemo(() => {
    const m = new Map<string, Map<string, MetricEntry[]>>();
    for (const e of visible) {
      const role = m.get(groupKey(e)) ?? new Map<string, MetricEntry[]>();
      const key = e.personaName ?? "(no persona)";
      role.set(key, [...(role.get(key) ?? []), e]);
      m.set(groupKey(e), role);
    }
    return m;
  }, [visible]);

  // feature 021: context-budget chip for the tabbed (or latest) model
  const contextModel = tab === "*" ? entries.at(-1)?.modelFile : tab;
  const latest = [...visible].reverse().find((e) => e.promptTokens > 0);
  const ctxUsed = latest ? latest.promptTokens + latest.outputTokens : null;
  const ctxTotal = contextModel ? (ctxSizes[contextModel] ?? null) : null;

  if (!open) return null;
  return (
    <div className="shrink-0 border-t border-border">
      <div className="flex items-center gap-2 px-4 py-1.5">
        <span className="text-xs font-medium">Metrics</span>
        <ContextChip used={ctxUsed} total={ctxTotal} />
        {models.length > 1 && (
          <div className="flex gap-1">
            {["*", ...models].map((m) => (
              <button
                key={m}
                onClick={() => setTab(m)}
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  tab === m
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {m === "*" ? "All" : m.replace(/\.gguf$/, "")}
              </button>
            ))}
          </div>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {visible.length} call{visible.length === 1 ? "" : "s"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px]"
          onClick={() => {
            void invoke("metrics.clear", {});
            setEntries([]);
          }}
        >
          Clear
        </Button>
      </div>
      <ScrollArea className="h-56">
        <div className="flex flex-col gap-1 px-4 pb-2">
          {visible.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No calls recorded yet.
            </p>
          )}
          {[...groups].map(([role, personas]) => (
            <div key={role}>
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {role}
              </div>
              {[...personas].map(([persona, list]) => (
                <div key={persona}>
                  <div className="pl-2 text-[10px] italic text-muted-foreground">
                    {persona}
                  </div>
                  {list.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-baseline gap-2 py-0.5 pl-4 text-[11px]"
                    >
                      <span className="shrink-0 text-muted-foreground">
                        {fmtTime(e.ts)}
                      </span>
                      <span className="shrink-0 font-medium">
                        {e.modelFile.replace(/\.gguf$/, "")}
                      </span>
                      {e.tag && (
                        <span className="shrink-0 rounded bg-muted px-1 text-[10px]">
                          {e.tag}
                        </span>
                      )}
                      {e.fallback && (
                        <span className="shrink-0 rounded bg-warning/15 px-1 text-[10px] text-warning">
                          fallback
                        </span>
                      )}
                      {e.status === "failed" ? (
                        <span className="shrink-0 text-destructive">failed</span>
                      ) : (
                        <span className="shrink-0 text-muted-foreground">
                          {e.promptTokens}→{e.outputTokens} tok ·{" "}
                          {(e.elapsedMs / 1000).toFixed(1)}s
                          {e.warm ? " · warm" : ""}
                        </span>
                      )}
                      <span className="min-w-0 truncate text-muted-foreground">
                        {e.promptPreview}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
