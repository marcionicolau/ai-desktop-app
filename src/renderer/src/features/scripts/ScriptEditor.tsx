// feature 023 (T029): create/edit a registry entry — name, runtime,
// stored source or external path, params table, timeout.
import { useState } from "react";
import type {
  ScriptListItem,
  ScriptParam,
  ScriptRuntimeKind,
} from "@shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useScripts } from "./use-scripts";

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

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Name</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="add-one"
            disabled={!!entry}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Runtime</span>
          <select
            className="flex h-9 w-full rounded-md border bg-transparent px-2 text-sm"
            value={runtime}
            onChange={(e) => setRuntime(e.target.value as ScriptRuntimeKind)}
          >
            <option value="python">Python</option>
            <option value="r">R</option>
          </select>
        </label>
      </div>
      <label className="block space-y-1 text-sm">
        <span className="text-muted-foreground">Description</span>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="what the model should know this does"
        />
      </label>
      <div className="space-y-1 text-sm">
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground">Source</span>
          <select
            className="h-8 rounded-md border bg-transparent px-2 text-sm"
            value={sourceKind}
            onChange={(e) =>
              setSourceKind(e.target.value as "stored" | "external")
            }
          >
            <option value="stored">Stored (edited here)</option>
            <option value="external">External file</option>
          </select>
        </div>
        {sourceKind === "stored" ? (
          <Textarea
            className="min-h-32 font-mono text-xs"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              runtime === "python"
                ? "print(ARGS['n'] + 1)"
                : "cat(ARGS$n + 1)"
            }
          />
        ) : (
          <Input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/absolute/path/to/script.py"
          />
        )}
      </div>
      <div className="space-y-1 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Params</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setParams((ps) => [
                ...ps,
                { name: "", type: "text", required: false },
              ])
            }
          >
            + param
          </Button>
        </div>
        {params.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              className="w-32"
              placeholder="name"
              value={p.name}
              onChange={(e) => setParam(i, { name: e.target.value })}
            />
            <select
              className="h-9 rounded-md border bg-transparent px-2 text-sm"
              value={p.type}
              onChange={(e) =>
                setParam(i, { type: e.target.value as ScriptParam["type"] })
              }
            >
              {PARAM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={p.required}
                onChange={(e) => setParam(i, { required: e.target.checked })}
              />
              required
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setParams((ps) => ps.filter((_, j) => j !== i))}
            >
              ×
            </Button>
          </div>
        ))}
      </div>
      <label className="block w-40 space-y-1 text-sm">
        <span className="text-muted-foreground">Timeout (ms)</span>
        <Input
          value={timeoutMs}
          onChange={(e) => setTimeoutMs(e.target.value)}
          placeholder="30000"
          inputMode="numeric"
        />
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !name.trim()} onClick={() => void save()}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
