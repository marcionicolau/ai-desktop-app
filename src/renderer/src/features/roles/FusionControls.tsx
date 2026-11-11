// Per-conversation fusion controls (T017): single/planner+executor mode
// toggle plus planner & executor tag selects. Bound tags only — enabling
// fusion with an unbound role is rejected by the backend (ROLE_UNBOUND)
// and surfaced here as an inline error.
import { useEffect, useMemo, useState } from "react";
import { useRoles } from "./use-roles";

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
}

export function FusionControls({
  mode,
  plannerTag,
  executorTag,
  generating,
  onSetMode,
}: Props) {
  const { tags } = useRoles();
  const bound = useMemo(() => tags.filter((t) => t.state === "bound"), [tags]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // role list changes (unbind) may invalidate current picks — surface state
  const plannerBound = bound.some((t) => t.name === plannerTag);
  const executorBound = bound.some((t) => t.name === executorTag);

  useEffect(() => setError(null), [mode, plannerTag, executorTag]);

  const apply = async (
    nextMode: "single" | "fusion",
    p = plannerTag,
    e = executorTag,
  ) => {
    setBusy(true);
    setError(null);
    try {
      await onSetMode(nextMode, p, e);
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
  );

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/50 px-4 py-2 text-xs">
      <label className="flex items-center gap-1.5">
        Mode
        <select
          className="h-7 rounded-md border border-border bg-background px-2"
          value={mode}
          disabled={busy || generating}
          onChange={(e) => void apply(e.target.value as "single" | "fusion")}
        >
          <option value="single">Single model</option>
          <option value="fusion">Planner + executor</option>
        </select>
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
            <span className="text-amber-500">
              bind both roles in the Roles panel to enable fusion
            </span>
          )}
        </>
      )}
      {error && <span className="text-red-400">{error}</span>}
    </div>
  );
}
