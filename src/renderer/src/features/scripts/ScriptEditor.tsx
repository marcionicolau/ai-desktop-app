// feature 023 (T029): create/edit a registry entry — name, runtime,
// stored source or external path, params table, timeout.
import { useId, useRef, useState } from "react";
import type {
  ScriptListItem,
  ScriptParam,
  ScriptRuntimeKind,
} from "@shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useScripts } from "./use-scripts";
import { SelectField } from "@/components/select-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { IconClose } from "@/components/icons";
import { confirm } from "@/lib/confirm";
import { useUnsavedGuard } from "../settings/use-unsaved-guard";
import {
  DEFAULT_SCRIPT_TIMEOUT,
  MAX_SCRIPT_TIMEOUT,
  validateExternalPath,
  validateParamRows,
  validateScriptName,
  validateTimeout,
} from "./script-rules";

const PARAM_TYPES: ScriptParam["type"][] = ["text", "number", "json", "bool"];

export function ScriptEditor({
  entry,
  onClose,
}: {
  entry: ScriptListItem | null;
  onClose: () => void;
}) {
  const { upsert } = useScripts();
  const [name, setName] = useState(entry?.id ?? "");
  const [runtime, setRuntime] = useState<ScriptRuntimeKind>(
    entry?.runtime ?? "python",
  );
  const [description, setDescription] = useState(entry?.description ?? "");
  const [sourceKind, setSourceKind] = useState<"stored" | "external">(
    entry?.source.kind ?? "stored",
  );
  const [text, setText] = useState("");
  const [path, setPath] = useState(
    entry?.source.kind === "external" ? entry.source.path : "",
  );
  const [params, setParams] = useState<ScriptParam[]>(entry?.params ?? []);
  const [timeoutMs, setTimeoutMs] = useState(
    entry?.timeoutMs?.toString() ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setParam = (i: number, patch: Partial<ScriptParam>) =>
    setParams((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await upsert({
        id: entry?.id,
        name,
        runtime,
        description,
        source:
          sourceKind === "stored"
            ? { kind: "stored", text }
            : { kind: "external", path },
        params,
        timeoutMs: timeoutMs ? Number(timeoutMs) : undefined,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const uid = useId();
  const initial = useRef(JSON.stringify({ name, runtime, description, sourceKind, text, path, params, timeoutMs })).current;
  const dirty =
    JSON.stringify({ name, runtime, description, sourceKind, text, path, params, timeoutMs }) !== initial;
  useUnsavedGuard(`script:${uid}`, `Script ${name || "(new)"}`, dirty);

  const [attempted, setAttempted] = useState(false);
  const nameErr = entry ? null : validateScriptName(name);
  const pathErr = sourceKind === "external" ? validateExternalPath(path) : null;
  const timeoutErr = validateTimeout(timeoutMs);
  const rowErrs = validateParamRows(params);
  const hasErrors = !!nameErr || !!pathErr || !!timeoutErr || Object.keys(rowErrs).length > 0;
  // required-field messages wait for a save attempt; format errors show as you type
  const showName = nameErr && (attempted || name !== "") ? nameErr : undefined;
  const showPath = pathErr && (attempted || path !== "") ? pathErr : undefined;

  const trySave = () => {
    if (hasErrors) {
      setAttempted(true);
      return;
    }
    void save();
  };
  const cancel = async () => {
    if (dirty) {
      const ok = await confirm({
        title: "Discard changes?",
        itemName: name || "New script",
        consequence: "Your edits to this script will be lost.",
        confirmLabel: "Discard",
      });
      if (!ok) return;
    }
    onClose();
  };

  return (
    <form
      className="space-y-4 rounded-md border p-4"
      aria-label={entry ? `Edit script ${entry.id}` : "New script"}
      onSubmit={(e) => {
        e.preventDefault();
        trySave();
      }}
    >
      <FieldGroup className="gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field data-invalid={showName ? true : undefined}>
            <FieldLabel htmlFor={`${uid}-name`}>Name</FieldLabel>
            <Input
              id={`${uid}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="add-one"
              disabled={!!entry}
              aria-invalid={showName ? true : undefined}
            />
            {showName ? (
              <FieldError>{showName}</FieldError>
            ) : (
              <FieldDescription>
                {entry ? "The name cannot change after it is created." : "Lowercase, with dashes. The model calls the script by this name."}
              </FieldDescription>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor={`${uid}-runtime`}>Language</FieldLabel>
            <SelectField
              id={`${uid}-runtime`}
              value={runtime}
              options={[
                { value: "python", label: "Python" },
                { value: "r", label: "R" },
              ]}
              onValueChange={(v) => setRuntime(v as ScriptRuntimeKind)}
            />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor={`${uid}-desc`}>Description</FieldLabel>
          <Input
            id={`${uid}-desc`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Adds one to a number"
          />
          <FieldDescription>What the model should know this script does.</FieldDescription>
        </Field>

        <Field data-invalid={showPath ? true : undefined}>
          <FieldLabel htmlFor={`${uid}-source`}>Source</FieldLabel>
          <SelectField
            id={`${uid}-source`}
            className="w-64"
            value={sourceKind}
            options={[
              { value: "stored", label: "Stored (edited here)" },
              { value: "external", label: "External file" },
            ]}
            onValueChange={(v) => setSourceKind(v as "stored" | "external")}
          />
          {sourceKind === "stored" ? (
            <Textarea
              aria-label="Script source"
              className="min-h-32 font-mono text-xs"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={runtime === "python" ? "print(ARGS['n'] + 1)" : "cat(ARGS$n + 1)"}
            />
          ) : (
            <>
              <Input
                aria-label="Script file path"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/absolute/path/to/script.py"
                aria-invalid={showPath ? true : undefined}
              />
              {showPath ? (
                <FieldError>{showPath}</FieldError>
              ) : (
                <FieldDescription>The file is read each time the script runs.</FieldDescription>
              )}
            </>
          )}
        </Field>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Parameters</p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setParams((ps) => [...ps, { name: "", type: "text", required: false }])}
            >
              + Add parameter
            </Button>
          </div>
          {params.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No parameters: the script receives plain text as <code>INPUT</code>.
            </p>
          )}
          {params.map((p, i) => (
            <div key={i} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="w-40"
                  aria-label={`Parameter ${i + 1} name`}
                  placeholder="name"
                  value={p.name}
                  onChange={(e) => setParam(i, { name: e.target.value })}
                  aria-invalid={rowErrs[i] && (attempted || p.name !== "") ? true : undefined}
                />
                <SelectField
                  aria-label={`Parameter ${i + 1} type`}
                  className="w-28"
                  value={p.type}
                  options={PARAM_TYPES.map((t) => ({ value: t, label: t }))}
                  onValueChange={(v) => setParam(i, { type: v as ScriptParam["type"] })}
                />
                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={p.required}
                    onCheckedChange={(v) => setParam(i, { required: v === true })}
                  />
                  Required
                </label>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove parameter ${i + 1}`}
                  onClick={() => setParams((ps) => ps.filter((_, j) => j !== i))}
                >
                  <IconClose aria-hidden="true" />
                </Button>
              </div>
              {rowErrs[i] && (attempted || p.name !== "") && (
                <p role="alert" className="text-xs text-destructive">
                  {rowErrs[i]}
                </p>
              )}
            </div>
          ))}
        </div>

        <Field className="w-56" data-invalid={timeoutErr ? true : undefined}>
          <FieldLabel htmlFor={`${uid}-timeout`}>Timeout</FieldLabel>
          <Input
            id={`${uid}-timeout`}
            value={timeoutMs}
            onChange={(e) => setTimeoutMs(e.target.value)}
            placeholder={String(DEFAULT_SCRIPT_TIMEOUT)}
            inputMode="numeric"
            aria-invalid={timeoutErr ? true : undefined}
          />
          {timeoutErr ? (
            <FieldError>{timeoutErr}</FieldError>
          ) : (
            <FieldDescription>Milliseconds, up to {MAX_SCRIPT_TIMEOUT}. Empty uses {DEFAULT_SCRIPT_TIMEOUT}.</FieldDescription>
          )}
        </Field>
      </FieldGroup>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => void cancel()}>
          Cancel
        </Button>
        {dirty && <Badge variant="warning">Unsaved changes</Badge>}
      </div>
    </form>
  );
}
