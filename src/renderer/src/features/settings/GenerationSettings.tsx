import { useState } from "react";
import type { GenerationParams } from "@shared/types";
import { DEFAULT_GENERATION } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface FieldDef {
  key: keyof GenerationParams;
  label: string;
  hint: string;
  step?: string;
  max?: number;
}

const FIELDS: FieldDef[] = [
  { key: "temperature", label: "Temperature", hint: "0–2 · 0 = greedy", step: "0.05", max: 2 },
  { key: "topP", label: "Top-p", hint: "0–1 · 1 = off", step: "0.05", max: 1 },
  { key: "topK", label: "Top-k", hint: "0 = off" },
  { key: "repeatPenalty", label: "Repeat penalty", hint: "1 = off", step: "0.05" },
  { key: "seed", label: "Seed", hint: "0 = random" },
  { key: "maxTokens", label: "Max tokens", hint: "0 = context-bound" },
  { key: "nThreads", label: "Threads", hint: "0 = auto" },
  { key: "nGpuLayers", label: "GPU layers", hint: "0 = CPU" },
];

interface Props {
  value: GenerationParams;
  onSave: (patch: Partial<GenerationParams>) => Promise<void>;
}

export function GenerationSettings({ value, onSave }: Props) {
  const [draft, setDraft] = useState<GenerationParams>(value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof GenerationParams, raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setDraft((d) => ({ ...d, [key]: n }));
  };

  const apply = async (next: GenerationParams) => {
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      setDraft(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-b border-border bg-muted/40 px-4 py-3">
      <div className="mx-auto grid max-w-2xl grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              {f.label}
              <span className="ml-1 opacity-70">{f.hint}</span>
            </span>
            <Input
              type="number"
              min={0}
              max={f.max}
              step={f.step ?? "1"}
              value={draft[f.key]}
              onChange={(e) => set(f.key, e.target.value)}
              className="h-8 text-sm"
            />
          </label>
        ))}
      </div>
      <div className="mx-auto mt-3 flex max-w-2xl items-center gap-2">
        <Button
          size="sm"
          disabled={saving}
          onClick={() => void apply(draft)}
        >
          Apply
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={saving}
          onClick={() => void apply({ ...DEFAULT_GENERATION })}
        >
          Reset to defaults
        </Button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}
