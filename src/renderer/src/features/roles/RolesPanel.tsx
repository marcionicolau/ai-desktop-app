import { useCallback, useEffect, useState } from "react";
import { Plus, Tags, Trash2 } from "lucide-react";
import type { ModelMeta, RoleView } from "@shared/types";
import { invoke } from "@/lib/rpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useRoles } from "./use-roles";
import { TagEditor } from "./TagEditor";

// rough memory-pressure heuristic: two fusion roles bound to models whose
// combined file size exceeds this warn the user (spec Assumptions)
const MEMORY_HINT_BYTES = 8 * 1024 * 1024 * 1024;

const STATE_STYLE: Record<RoleView["state"], string> = {
  bound: "bg-emerald-950 text-emerald-300",
  unbound: "bg-muted text-muted-foreground",
  broken: "bg-red-950 text-red-300",
};

export function RolesPanel() {
  const { tags, create, remove } = useRoles();
  const [models, setModels] = useState<ModelMeta[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refreshModels = useCallback(async () => {
    try {
      const res = await invoke("model.list", {});
      setModels(res.models);
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  const add = async () => {
    setError(null);
    try {
      await create({ name: newName.trim() });
      setNewName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const del = async (name: string) => {
    setError(null);
    try {
      await remove(name);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // ROLE_IN_USE: offer detach-with-confirmation as a second click path
      if (msg.includes("referenced by") && window.confirm(`${msg}\n\nDetach and delete anyway?`)) {
        try {
          await remove(name, true);
        } catch (e2) {
          setError(e2 instanceof Error ? e2.message : String(e2));
        }
      } else {
        setError(msg);
      }
    }
  };

  const sizeOf = (t: RoleView) =>
    t.binding ? (models.find((m) => m.fileName === t.binding)?.sizeBytes ?? 0) : 0;
  const combinedBytes = ["planner", "executor"]
    .map((n) => tags.find((t) => t.name === n))
    .reduce((acc, t) => acc + (t ? sizeOf(t) : 0), 0);
  const pressure = combinedBytes > MEMORY_HINT_BYTES;

  return (
    <div className="border-b border-border bg-muted/40 px-4 py-3">
      <div className="mx-auto max-w-2xl space-y-3">
        <div className="flex items-center gap-2">
          <Tags className="size-4 text-muted-foreground" />
          <h2 className="text-xs font-semibold">Model roles</h2>
        </div>
        {pressure && (
          <p className="rounded border border-amber-800 bg-amber-950/60 px-2 py-1 text-xs text-amber-300">
            Planner + executor bindings total {(combinedBytes / 1e9).toFixed(1)} GB —
            fusion keeps both loaded; watch memory.
          </p>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="divide-y divide-border text-xs">
          {tags.map((t) => (
            <div key={t.name} className="py-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">{t.label ?? t.name}</span>
                <span className="text-muted-foreground">{t.name}</span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] uppercase",
                    STATE_STYLE[t.state],
                  )}
                >
                  {t.state}
                </span>
                <span className="flex-1 truncate text-muted-foreground">
                  {t.binding
                    ? t.resolvedFile
                      ? `${t.resolvedFile.name ?? t.binding} · ${t.resolvedFile.quantization ?? "?"}`
                      : t.binding
                    : "—"}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(editing === t.name ? null : t.name)}
                >
                  {editing === t.name ? "Close" : "Edit"}
                </Button>
                {t.name !== "default" && t.name !== "planner" && t.name !== "executor" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Delete tag"
                    onClick={() => void del(t.name)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
              {editing === t.name && (
                <TagEditor tag={t} models={models} tags={tags} onError={setError} />
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="new-tag-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="h-8 w-48 text-xs"
          />
          <Button size="sm" disabled={!newName.trim()} onClick={() => void add()}>
            <Plus className="size-3.5" /> Add tag
          </Button>
        </div>
      </div>
    </div>
  );
}
