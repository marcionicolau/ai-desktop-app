// feature 027 (US1, FR-004/015/016/023): script workspace surface —
// opens directly to run form + code + params; in-place metadata editing;
// external/source-missing badges + Relink. Code pane is read-only for
// linked scripts (clarify Q1) and shows the file's current content.
import { useEffect, useState } from "react";
import type { ScriptListItem, ScriptRuntimeKind } from "@shared/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/empty-state";
import { confirm } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { IconTerminal, IconWarning } from "@/components/icons";
import { useScripts } from "./use-scripts";
import { ScriptEditor } from "./ScriptEditor";
import { RunForm } from "./RunForm";

const RT_LABEL: Record<ScriptRuntimeKind, string> = { python: "Python", r: "R" };

function CodePane({ script }: { script: ScriptListItem }) {
  const { readSource } = useScripts();
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    setText(null);
    void readSource(script.id).then(setText);
  }, [script.id, script.enabled, readSource]);
  return (
    <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs">
      {text ?? (script.linked ? "(source unreadable)" : "(no source)")}
    </pre>
  );
}

export function ScriptDetail({
  scriptId,
  onNew,
  onImport,
  onOpenRuntimeSettings,
}: {
  scriptId: string | null;
  onNew: () => void;
  onImport: () => void;
  onOpenRuntimeSettings: () => void;
}) {
  const { scripts, setEnabled, remove, relink, refresh } = useScripts();
  const [editing, setEditing] = useState(false);

  const entry = scriptId ? scripts.find((s) => s.id === scriptId) : null;

  if (editing && entry) {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <ScriptEditor entry={entry} onClose={() => setEditing(false)} />
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 p-6">
        {scriptId === "__new__" ? (
          <ScriptEditor entry={null} onClose={() => onNew()} />
        ) : (
          <EmptyState
            icon={IconTerminal}
            title={scripts.length === 0 ? "No scripts yet" : "No script selected"}
            description={
              scripts.length === 0
                ? "Create a script to let the model run local Python or R, or import one from a file."
                : "Pick a script from the sidebar, or create a new one."
            }
            action={{ label: "New script", onClick: onNew }}
          />
        )}
        {scripts.length === 0 && scriptId !== "__new__" && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={onImport}>
              Import from file…
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate font-mono text-lg font-semibold" title={entry.id}>
              {entry.id}
            </h1>
            <Badge variant={entry.runtimeStatus === "ready" ? "secondary" : "destructive"}>
              {RT_LABEL[entry.runtime]}
              {entry.runtimeStatus !== "ready" ? " · missing" : ""}
            </Badge>
            {entry.linked && (
              <Badge variant="outline" title={entry.source.kind === "external" ? entry.source.path : undefined}>
                external
              </Badge>
            )}
            {!entry.enabled && <Badge variant="outline">disabled</Badge>}
          </div>
          {entry.source.kind === "external" && (
            <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={entry.source.path}>
              {entry.source.path}
            </p>
          )}
          {entry.description && (
            <p className="mt-0.5 text-sm text-muted-foreground">{entry.description}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => void setEnabled(entry.id, !entry.enabled)}>
            {entry.enabled ? "Disable" : "Enable"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() =>
              void (async () => {
                const ok = await confirm({
                  title: "Delete script",
                  itemName: entry.id,
                  consequence: entry.linked
                    ? "The script is unregistered; the linked file is left untouched."
                    : "The script and its stored copy are deleted.",
                });
                if (ok) await remove(entry.id);
              })()
            }
          >
            Delete
          </Button>
        </div>
      </div>

      {entry.runtimeStatus !== "ready" && (
        <Alert variant="default">
          <IconWarning className="size-4" />
          <AlertTitle>Runtime missing</AlertTitle>
          <AlertDescription>
            No {RT_LABEL[entry.runtime]} interpreter found.{" "}
            <button className="underline" onClick={onOpenRuntimeSettings}>
              Configure runtime paths
            </button>
          </AlertDescription>
        </Alert>
      )}

      {entry.sourceState === "missing" && (
        <Alert variant="destructive">
          <IconWarning className="size-4" />
          <AlertTitle>Source missing</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            The linked file is missing or unreadable; runs are refused.
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void relink(entry.id)
                  .then((e) => {
                    if (e) notify.success(`Relinked to ${e.id}`);
                    void refresh();
                  })
                  .catch((err) => notify.error("Relink failed", { description: String(err) }))
              }
            >
              Relink…
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Separator />

      {entry.enabled && entry.runtimeStatus === "ready" && entry.sourceState === "ok" && (
        <RunForm scripts={[entry]} />
      )}

      {entry.params.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-medium">Parameters</p>
          <ul className="space-y-1 text-sm">
            {entry.params.map((p) => (
              <li key={p.name} className="flex gap-2">
                <code className="font-mono">{p.name}</code>
                <span className="text-muted-foreground">
                  {p.type}
                  {p.required ? " · required" : ""}
                  {p.description ? ` — ${p.description}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-1 text-sm font-medium">
          Code
          {entry.linked && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              (read-only — edit the file on disk)
            </span>
          )}
        </p>
        <CodePane script={entry} />
      </div>
    </div>
  );
}
