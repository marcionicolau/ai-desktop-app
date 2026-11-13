// Per-conversation fusion controls (T017): single/planner+executor mode
// toggle plus planner & executor tag selects. Bound tags only — enabling
// fusion with an unbound role is rejected by the backend (ROLE_UNBOUND)
// and surfaced here as an inline error.
import { WithReason } from "@/components/with-reason";
import { useEffect, useMemo, useState } from "react";
import type { FusionAdvise } from "@shared/types";
import { invoke } from "@/lib/rpc";
import { useRoles } from "./use-roles";

const fmtGb = (n: number) => `${(n / 1e9).toFixed(1)} GB`;

interface Props {
  mode: "single" | "fusion";
  plannerTag: string;
  executorTag: string;
  generating: boolean;
  onSetMode: (
    mode: "single" | "fusion",
    plannerTag: string,
    executorTag: string,
  ) => Promise<void>;
  // fired after switching to fusion while a role is unbound — host opens
  // the bindings UI so model selection actually happens (not just a hint)
  onUnbound?: () => void;
}

export function FusionControls({
  mode,
  plannerTag,
  executorTag,
  generating,
  onSetMode,
  onUnbound,
}: Props) {
  const { tags } = useRoles();
  const bound = useMemo(() => tags.filter((t) => t.state === "bound"), [tags]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // FR-019: controls are locked while a reply streams or a change applies
  const lockReason = generating
    ? "Wait for the current reply to finish"
    : busy
      ? "Applying the change…"
      : undefined;

  // role list changes (unbind) may invalidate current picks — surface state
  const plannerBound = bound.some((t) => t.name === plannerTag);
  const executorBound = bound.some((t) => t.name === executorTag);

  useEffect(() => setError(null), [mode, plannerTag, executorTag]);

  // feature 011: live combined-fit verdict for the bound pair
  const [fusion, setFusion] = useState<FusionAdvise | null>(null);
  useEffect(() => {
    if (mode !== "fusion" || !plannerBound || !executorBound) {
      setFusion(null);
      return;
    }
    let live = true;
    void invoke("model.advise", { plannerTag, executorTag })
      .then((r) => {
        if (live) setFusion(r.fusion ?? null);
      })
      .catch(() => {
        if (live) setFusion(null);
      });
    return () => {
      live = false;
    };
  }, [mode, plannerTag, executorTag, plannerBound, executorBound]);

  const apply = async (
    nextMode: "single" | "fusion",
    p = plannerTag,
    e = executorTag,
  ) => {
    setBusy(true);
    setError(null);
    try {
      await onSetMode(nextMode, p, e);
      if (nextMode === "fusion") {
        const pBound = bound.some((t) => t.name === p);
        const eBound = bound.some((t) => t.name === e);
        if (!pBound || !eBound) onUnbound?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const TagSelect = ({
    value,
    onChange,
    id,
  }: {
    value: string;
    onChange: (v: string) => void;
    id: string;
  }) => (
    <WithReason reason={lockReason}>
    <select
      id={id}
      className="h-7 rounded-md border border-border bg-background px-2 text-xs"
      value={value}
      disabled={busy || generating}
      onChange={(e) => void onChange(e.target.value)}
    >
      {!bound.some((t) => t.name === value) && (
        <option value={value}>{value} (unbound)</option>
      )}
      {bound.map((t) => (
        <option key={t.name} value={t.name}>
          {t.label ?? t.name} — {t.binding ?? ""}
        </option>
      ))}
    </select>
    </WithReason>
  );

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/50 px-4 py-2 text-xs">
      <label className="flex items-center gap-1.5">
        Mode
        <WithReason reason={lockReason}>
          <select
            className="h-7 rounded-md border border-border bg-background px-2"
            value={mode}
            disabled={busy || generating}
            onChange={(e) => void apply(e.target.value as "single" | "fusion")}
          >
            <option value="single">Single model</option>
            <option value="fusion">Planner + executor</option>
          </select>
        </WithReason>
      </label>
      {mode === "fusion" && (
        <>
          <label className="flex items-center gap-1.5">
            Planner
            <TagSelect
              id="planner-tag"
              value={plannerTag}
              onChange={(v) => void apply("fusion", v, executorTag)}
            />
          </label>
          <label className="flex items-center gap-1.5">
            Executor
            <TagSelect
              id="executor-tag"
              value={executorTag}
              onChange={(v) => void apply("fusion", plannerTag, v)}
            />
          </label>
          {(!plannerBound || !executorBound) && (
            <span className="text-warning">
              bind both roles in the Roles panel to enable fusion
            </span>
          )}
          {fusion && (
            <span
              className={
                fusion.verdict === "fits"
                  ? "text-success"
                  : fusion.verdict === "tight"
                    ? "text-warning"
                    : "text-destructive"
              }
              title={`sequential peak ${fmtGb(fusion.sequentialPeakBytes)} · both resident ${fmtGb(fusion.combinedBytes)}`}
            >
              pair: {fusion.verdict === "wontfit" ? "won't fit" : fusion.verdict}
              {" · peak "}
              {fmtGb(fusion.sequentialPeakBytes)}
              {" · both "}
              {fmtGb(fusion.combinedBytes)}
            </span>
          )}
        </>
      )}
      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
}
