// feature 026 (FR-023, FR-024): the single place where a chat's mode, models
// and persona are chosen. Replaces the header pills + second FusionControls
// bar + native persona <select> that repeated the same choices.
import { useEffect, useState } from "react";
import type { FusionAdvise } from "@shared/types";
import { ModelSelector, type ModelOption } from "@/components/ai/model-selector";
import { Badge } from "@/components/ui/badge";
import { WithReason } from "@/components/with-reason";
import { invoke } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import {
  fitStatus,
  idToPersona,
  modelControls,
  NO_PERSONA,
  personaToId,
  unboundRoles,
  type ChatMode,
} from "./chat-setup";

interface Props {
  mode: ChatMode;
  plannerTag: string;
  executorTag: string;
  // the tag the single-mode model was applied from
  modelTagName: string | null;
  boundTags: ModelOption[];
  personas: { name: string }[];
  personaName: string | null;
  generating: boolean;
  onSetMode: (mode: ChatMode, plannerTag: string, executorTag: string) => Promise<void>;
  onApplyTag: (tag: string) => Promise<void>;
  onPersona: (name: string | null) => Promise<void> | void;
  onManageRoles: () => void;
  onManageModels: () => void;
  // errors and unbound-role guidance are shown by the host as one alert
  onError: (message: string | null) => void;
  onUnbound: () => void;
}

function ModeToggle({
  mode,
  disabled,
  onChange,
}: {
  mode: ChatMode;
  disabled: boolean;
  onChange: (m: ChatMode) => void;
}) {
  const opts: { id: ChatMode; label: string }[] = [
    { id: "single", label: "Single" },
    { id: "fusion", label: "Fusion" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Mode"
      className="inline-flex h-7 items-center rounded-md border border-input bg-card p-0.5 text-xs"
    >
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={mode === o.id}
          disabled={disabled}
          onClick={() => mode !== o.id && onChange(o.id)}
          className={cn(
            "h-full rounded px-2.5 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            mode === o.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// live combined-fit verdict for the bound pair (feature 011), shown as a
// compact badge — the figures are on hover/focus, not in a separate row
function FitBadge({
  plannerTag,
  executorTag,
  active,
}: {
  plannerTag: string;
  executorTag: string;
  active: boolean;
}) {
  const [fusion, setFusion] = useState<FusionAdvise | null>(null);
  useEffect(() => {
    if (!active) {
      setFusion(null);
      return;
    }
    let live = true;
    void invoke("model.advise", { plannerTag, executorTag })
      .then((r) => live && setFusion(r.fusion ?? null))
      .catch(() => live && setFusion(null));
    return () => {
      live = false;
    };
  }, [active, plannerTag, executorTag]);
  if (!fusion) return null;
  const s = fitStatus(fusion);
  return (
    <WithReason reason={s.detail}>
      <Badge variant={s.variant}>{s.label}</Badge>
    </WithReason>
  );
}

export function ChatSetup({
  mode,
  plannerTag,
  executorTag,
  modelTagName,
  boundTags,
  personas,
  personaName,
  generating,
  onSetMode,
  onApplyTag,
  onPersona,
  onManageRoles,
  onManageModels,
  onError,
  onUnbound,
}: Props) {
  const [busy, setBusy] = useState(false);
  const locked = generating || busy;
  // FR-019: say why the controls are locked
  const lockReason = generating
    ? "Wait for the current reply to finish"
    : busy
      ? "Applying the change…"
      : undefined;
  const boundNames = boundTags.map((t) => t.id);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    onError(null);
    try {
      await fn();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const applyMode = (m: ChatMode, p = plannerTag, e = executorTag) =>
    run(async () => {
      await onSetMode(m, p, e);
      if (unboundRoles(m, p, e, boundNames).length > 0) onUnbound();
    });

  const controls = modelControls(mode);
  const personaOptions: ModelOption[] = [
    { id: NO_PERSONA, label: "No persona" },
    ...personas.map((p) => ({ id: p.name, label: p.name })),
  ];
  const pairBound = unboundRoles(mode, plannerTag, executorTag, boundNames).length === 0;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <WithReason reason={lockReason}>
        <ModeToggle mode={mode} disabled={locked} onChange={(m) => void applyMode(m)} />
      </WithReason>

      {controls.includes("model") && (
        <WithReason reason={lockReason}>
          <ModelSelector
            label="Model"
            value={modelTagName}
            options={boundTags}
            onSelect={(t) => void run(() => onApplyTag(t))}
            onManage={onManageModels}
            disabled={locked}
          />
        </WithReason>
      )}
      {controls.includes("planner") && (
        <WithReason reason={lockReason}>
          <ModelSelector
            label="Planner"
            value={plannerTag}
            options={boundTags}
            onSelect={(t) => void applyMode("fusion", t, executorTag)}
            onManage={onManageRoles}
            disabled={locked}
          />
        </WithReason>
      )}
      {controls.includes("executor") && (
        <WithReason reason={lockReason}>
          <ModelSelector
            label="Executor"
            value={executorTag}
            options={boundTags}
            onSelect={(t) => void applyMode("fusion", plannerTag, t)}
            onManage={onManageRoles}
            disabled={locked}
          />
        </WithReason>
      )}
      <FitBadge plannerTag={plannerTag} executorTag={executorTag} active={mode === "fusion" && pairBound} />

      <ModelSelector
        label="Persona"
        value={personaToId(personaName)}
        options={personaOptions}
        onSelect={(id) => void onPersona(idToPersona(id))}
      />
    </div>
  );
}
