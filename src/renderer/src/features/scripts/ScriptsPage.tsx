// feature 023 (T028/T036): script library — list with runtime badges,
// enabled toggles, editor + manual run form. Runtime health row sits
// on top (T035 settings live in the settings surface).
import { confirm } from "@/lib/confirm";
import { EmptyState } from "@/components/empty-state";
import { IconTerminal } from "@/components/icons";
import { useState } from "react";
import type { ScriptListItem, ScriptRuntimeKind } from "@shared/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useScripts } from "./use-scripts";
import { ScriptEditor } from "./ScriptEditor";
import { RunForm } from "./RunForm";

const RT_LABEL: Record<ScriptRuntimeKind, string> = {
  python: "Python",
  r: "R",
};

function RuntimeBadge({ item }: { item: ScriptListItem }) {
  return (
    <Badge variant={item.runtimeStatus === "ready" ? "secondary" : "destructive"}>
      {RT_LABEL[item.runtime]}
      {item.runtimeStatus !== "ready" ? " · missing" : ""}
    </Badge>
  );
}

export function ScriptsPage() {
  const { scripts, runtimes, setEnabled, remove } = useScripts();
  const [editing, setEditing] = useState<ScriptListItem | "new" | null>(null);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Scripts</h1>
          <p className="text-sm text-muted-foreground">
            Python and R scripts the model (or you) can run locally.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          New script
        </Button>
      </div>

      {/* runtime health row (T036) */}
      <div className="flex gap-3">
        {runtimes.map((r) => (
          <div
            key={r.kind}
            className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs"
          >
            <span className="font-medium">{RT_LABEL[r.kind]}</span>
            <Badge
              variant={r.status === "ready" ? "secondary" : "destructive"}
            >
              {r.status}
            </Badge>
            {r.session && (
              <span className="text-muted-foreground">
                {r.session.state} · {r.session.calls} calls
                {r.session.restartCount > 0 &&
                  ` · ${r.session.restartCount} restarts`}
              </span>
            )}
          </div>
        ))}
      </div>
      <Separator />

      {editing !== null ? (
        <ScriptEditor
          entry={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : scripts.length === 0 ? (
        <EmptyState
          icon={IconTerminal}
          title="No scripts yet"
          description="Create a script to let the model run local Python or R."
          action={{ label: "New script", onClick: () => setEditing("new") }}
        />
      ) : (
        <ul className="space-y-2">
          {scripts.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{s.id}</span>
                  <RuntimeBadge item={s} />
                  {!s.enabled && <Badge variant="outline">disabled</Badge>}
                </div>
                {s.description && (
                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {s.description}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void setEnabled(s.id, !s.enabled)}
                >
                  {s.enabled ? "Disable" : "Enable"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(s)}
                >
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
                        itemName: s.id,
                        consequence: "The script is unregistered; a stored copy is deleted.",
                      });
                      if (ok) await remove(s.id);
                    })()
                  }
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {scripts.filter((s) => s.enabled).length > 0 && editing === null && (
        <>
          <Separator />
          <RunForm
            scripts={scripts.filter((s) => s.enabled && s.runtimeStatus === "ready")}
          />
        </>
      )}
    </div>
  );
}
