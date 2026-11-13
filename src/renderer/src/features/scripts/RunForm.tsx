// feature 023 (T030): manual run — declared-params form, captured
// result view (stdout/stderr/exit/duration), produced files.
import { SelectField } from "@/components/select-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { validateRunArgs } from "./script-rules";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { IconError } from "@/components/icons";
import { useState } from "react";
import type { ScriptListItem, ScriptRunRecord } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useScripts } from "./use-scripts";

export function RunForm({ scripts }: { scripts: ScriptListItem[] }) {
  const { run } = useScripts();
  const [id, setId] = useState(scripts[0]?.id ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [input, setInput] = useState("");
  const [record, setRecord] = useState<ScriptRunRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const entry = scripts.find((s) => s.id === id);
  const argErrors = validateRunArgs(entry?.params ?? [], values);
  const hasArgErrors = Object.keys(argErrors).length > 0;

  const buildArgs = () => {
    const out: Record<string, unknown> = {};
    for (const p of entry?.params ?? []) {
      const raw = values[p.name];
      if (raw === undefined || raw === "") continue;
      out[p.name] =
        p.type === "number"
          ? Number(raw)
          : p.type === "bool"
            ? raw === "true" || raw === "1"
            : p.type === "json"
              ? JSON.parse(raw)
              : raw;
    }
    return out;
  };

  const go = async () => {
    setBusy(true);
    setError(null);
    setRecord(null);
    try {
      const args = buildArgs();
      // paramless scripts take the raw-text input as args.input
      const r = await run(
        id,
        entry && entry.params.length > 0 ? args : { input },
      );
      setRecord(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border p-4">
      <h2 className="text-sm font-medium">Run a script</h2>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <label htmlFor="run-script" className="sr-only">Script to run</label>
          <SelectField
            id="run-script"
            value={id}
            options={scripts.map((s) => ({ value: s.id, label: s.id }))}
            onValueChange={(v) => {
              setId(v);
              setValues({});
              setRecord(null);
            }}
          />
        </div>
        <Button size="sm" disabled={busy || !id || hasArgErrors} aria-busy={busy} onClick={() => void go()}>
          {busy ? "Running…" : "Run"}
        </Button>
      </div>
      {entry?.params.map((p) => {
        const err = argErrors[p.name];
        const fid = `run-${p.name}`;
        const label = (
          <FieldLabel htmlFor={fid}>
            {p.name}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              {p.type}
              {p.required ? ", required" : ""}
            </span>
          </FieldLabel>
        );
        return (
          <Field key={p.name} data-invalid={err ? true : undefined}>
            {p.type === "bool" ? (
              <label htmlFor={fid} className="flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  id={fid}
                  checked={values[p.name] === "true"}
                  onCheckedChange={(v) => setValues((o) => ({ ...o, [p.name]: v === true ? "true" : "false" }))}
                />
                {p.name}
                <span className="text-xs font-normal text-muted-foreground">{p.required ? "required" : "optional"}</span>
              </label>
            ) : p.type === "json" ? (
              <>
                {label}
                <Textarea
                  id={fid}
                  className="min-h-20 font-mono text-xs"
                  value={values[p.name] ?? ""}
                  placeholder='{"key": "value"}'
                  aria-invalid={err ? true : undefined}
                  onChange={(e) => setValues((o) => ({ ...o, [p.name]: e.target.value }))}
                />
              </>
            ) : (
              <>
                {label}
                <Input
                  id={fid}
                  value={values[p.name] ?? ""}
                  inputMode={p.type === "number" ? "decimal" : undefined}
                  aria-invalid={err ? true : undefined}
                  onChange={(e) => setValues((o) => ({ ...o, [p.name]: e.target.value }))}
                />
              </>
            )}
            {err && <FieldError>{err}</FieldError>}
          </Field>
        );
      })}
      {entry && entry.params.length === 0 && (
        <Field>
          <FieldLabel htmlFor="run-input">Input</FieldLabel>
          <Input id="run-input" value={input} onChange={(e) => setInput(e.target.value)} />
          <FieldDescription>Plain text the script receives as INPUT.</FieldDescription>
        </Field>
      )}
      {error && (
        <Alert variant="destructive">
          <IconError aria-hidden="true" />
          <AlertTitle>The script run failed</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {error}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void go()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {record && (
        <div className="space-y-1 rounded bg-muted p-3 font-mono text-xs">
          <div className="flex gap-3 text-muted-foreground">
            <span>verdict: {record.verdict}</span>
            {record.exitStatus !== null && <span>exit {record.exitStatus}</span>}
            <span>{Math.round(record.durationMs)} ms</span>
            {record.sessionRestarted && (
              <span className="text-warning">session restarted</span>
            )}
          </div>
          {record.stdout && (
            <pre className="whitespace-pre-wrap break-words">{record.stdout}</pre>
          )}
          {record.stderr && (
            <pre className="whitespace-pre-wrap break-words text-destructive">
              {record.stderr}
            </pre>
          )}
          {record.files.length > 0 && (
            <p className="text-muted-foreground">
              files: {record.files.join(", ")} (in run dir {record.runId})
            </p>
          )}
        </div>
      )}
    </div>
  );
}
