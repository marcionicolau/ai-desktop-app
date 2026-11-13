// feature 026 (FR-013): per-model generation overrides as a proper form —
// every field shows its range, unit and help, validates inline without
// losing what was typed, shows what an empty box inherits, and warns about
// unsaved edits. Replaces the cramped row of bare number inputs.
import { useEffect, useMemo, useState } from "react";
import type { GenerationParams } from "@shared/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { invoke } from "@/lib/rpc";
import { notify } from "@/lib/notify";
import { ParamField } from "../settings/ParamField";
import {
  draftErrors,
  draftToParams,
  PARAM_SPECS,
  paramsToDraft,
  sameDraft,
  serverErrorKey,
  type ParamDraft,
} from "../settings/param-spec";
import { useUnsavedGuard } from "../settings/use-unsaved-guard";

export function OverrideEditor({
  fileName,
  onClose,
}: {
  fileName: string;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<ParamDraft | null>(null);
  const [draft, setDraft] = useState<ParamDraft>({});
  const [global, setGlobal] = useState<GenerationParams | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // start from what is already saved, not from an empty form
  useEffect(() => {
    let live = true;
    void invoke("settings.get", {}).then((s) => {
      if (!live) return;
      const existing = paramsToDraft(s.modelOverrides[fileName]);
      setLoaded(existing);
      setDraft(existing);
      setGlobal(s.generation);
    });
    return () => {
      live = false;
    };
  }, [fileName]);

  const errors = useMemo(() => draftErrors(draft), [draft]);
  const hasErrors = Object.keys(errors).length > 0;
  const dirty = loaded !== null && !sameDraft(draft, loaded);
  useUnsavedGuard(`override:${fileName}`, `Generation overrides for ${fileName}`, dirty);

  const fieldKey = serverError ? serverErrorKey(serverError) : null;

  const save = async (params: Partial<GenerationParams> | null) => {
    setSaving(true);
    setServerError(null);
    try {
      await invoke("model.setOverride", { fileName, params });
      notify.success(params ? "Override saved" : "Override cleared", { description: fileName });
      onClose();
    } catch (e) {
      // keep everything the user typed; show what the server rejected
      setServerError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loaded === null) {
    return <p className="mt-2 text-xs text-muted-foreground">Loading overrides…</p>;
  }

  return (
    <form
      className="mt-2 space-y-3 rounded-md border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!hasErrors && dirty) void save(draftToParams(draft));
      }}
      aria-label={`Generation overrides for ${fileName}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">
          Overrides for <span className="font-medium text-foreground">{fileName}</span> — a field
          you leave empty uses the default shown in it.
        </p>
        {dirty && <Badge variant="warning">Unsaved changes</Badge>}
      </div>
      <FieldGroup className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
        {PARAM_SPECS.map((spec) => (
          <ParamField
            key={spec.key}
            spec={spec}
            value={draft[spec.key] ?? ""}
            onChange={(text) => {
              setServerError(null);
              setDraft((d) => ({ ...d, [spec.key]: text }));
            }}
            error={errors[spec.key] ?? (fieldKey === spec.key ? serverError ?? undefined : undefined)}
            inheritedHint={global ? `default ${global[spec.key]}` : undefined}
            disabled={saving}
          />
        ))}
      </FieldGroup>
      {serverError && !fieldKey && (
        <Alert variant="destructive">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={saving || hasErrors || !dirty}>
          Save override
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={saving || Object.keys(loaded).length === 0}
          onClick={() => void save(null)}
        >
          Clear override
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onClose}>
          {dirty ? "Discard changes" : "Close"}
        </Button>
        {hasErrors && (
          <span className="text-xs text-destructive">Fix the highlighted fields to save.</span>
        )}
      </div>
    </form>
  );
}
