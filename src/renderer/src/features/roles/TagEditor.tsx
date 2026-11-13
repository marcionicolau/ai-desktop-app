import { useState } from "react";
import { IconAdd, IconClose } from "@/components/icons";
import type { GenerationParams, ModelMeta, RoleRef, RoleView } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRoles } from "./use-roles";

const PARAM_FIELDS: { key: keyof GenerationParams; label: string }[] = [
  { key: "temperature", label: "Temp" },
  { key: "topP", label: "Top-p" },
  { key: "topK", label: "Top-k" },
  { key: "repeatPenalty", label: "Penalty" },
  { key: "seed", label: "Seed" },
  { key: "maxTokens", label: "Max tok" },
];

interface Props {
  tag: RoleView;
  models: ModelMeta[];
  tags?: RoleView[];
  onError: (msg: string | null) => void;
}

export function TagEditor({ tag, models, tags = [], onError }: Props) {
  const { update, bind, setFallback } = useRoles();
  const [label, setLabel] = useState(tag.label ?? "");
  const [description, setDescription] = useState(tag.description ?? "");
  const [draft, setDraft] = useState<Partial<GenerationParams>>(tag.params);
  const [chain, setChain] = useState<RoleRef[]>(tag.fallback);

  const run = (fn: () => Promise<unknown>) => {
    onError(null);
    void fn().catch((e) =>
      onError(e instanceof Error ? e.message : String(e)),
    );
  };

  const otherTags = tags.filter((t) => t.name !== tag.name);

  return (
    <div className="mt-2 space-y-3 rounded-md border border-border p-2">
      <div className="flex gap-2">
        <Input
          placeholder="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="h-7 w-40 text-xs"
        />
        <Input
          placeholder="Purpose (e.g. planning model)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="h-7 flex-1 text-xs"
        />
        <Button
          size="sm"
          onClick={() =>
            run(() =>
              update({ name: tag.name, label, description }),
            )
          }
        >
          Save
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-20 text-muted-foreground">Bound model</span>
        <select
          className="h-7 flex-1 rounded border border-border bg-background px-1 text-xs"
          value={tag.binding ?? ""}
          onChange={(e) =>
            run(() => bind(tag.name, e.target.value || null))
          }
        >
          <option value="">— unbound —</option>
          {models.map((m) => (
            <option key={m.fileName} value={m.fileName}>
              {m.name ?? m.fileName} ({m.quantization ?? "?"})
            </option>
          ))}
        </select>
      </div>

      <div>
        <p className="mb-1 text-muted-foreground">
          Generation overrides — empty fields inherit global/model settings.
        </p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {PARAM_FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="text-muted-foreground">{f.label}</span>
              <Input
                type="number"
                step="any"
                placeholder="—"
                value={draft[f.key] ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setDraft((d) => ({
                    ...d,
                    [f.key]: v === "" ? undefined : Number(v),
                  }));
                }}
                className="h-7 text-xs"
              />
            </label>
          ))}
        </div>
        <div className="mt-1 flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              run(() =>
                update({
                  name: tag.name,
                  params: Object.fromEntries(
                    Object.entries(draft).filter(
                      ([, v]) => v !== undefined && Number.isFinite(v),
                    ),
                  ),
                }),
              )
            }
          >
            Save params
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft({});
              run(() => update({ name: tag.name, params: null }));
            }}
          >
            Clear
          </Button>
        </div>
      </div>

      <div>
        <p className="mb-1 text-muted-foreground">
          Fallback chain (max 3, tried in order when the binding fails).
        </p>
        {chain.map((r, i) => (
          <div key={i} className="mb-1 flex items-center gap-2">
            <select
              className="h-7 w-24 rounded border border-border bg-background px-1 text-xs"
              value={r.kind}
              onChange={(e) => {
                const kind = e.target.value as RoleRef["kind"];
                setChain((c) =>
                  c.map((o, j) =>
                    j === i
                      ? kind === "tag"
                        ? { kind: "tag", name: otherTags[0]?.name ?? "" }
                        : { kind: "model", fileName: models[0]?.fileName ?? "" }
                      : o,
                  ),
                );
              }}
            >
              <option value="tag">tag</option>
              <option value="model">model</option>
            </select>
            <select
              className="h-7 flex-1 rounded border border-border bg-background px-1 text-xs"
              value={r.kind === "tag" ? r.name : r.fileName}
              onChange={(e) => {
                const v = e.target.value;
                setChain((c) =>
                  c.map((o, j) =>
                    j === i
                      ? o.kind === "tag"
                        ? { kind: "tag", name: v }
                        : { kind: "model", fileName: v }
                      : o,
                  ),
                );
              }}
            >
              {r.kind === "tag"
                ? otherTags.map((o) => (
                    <option key={o.name} value={o.name}>
                      {o.label ?? o.name}
                    </option>
                  ))
                : models.map((m) => (
                    <option key={m.fileName} value={m.fileName}>
                      {m.name ?? m.fileName}
                    </option>
                  ))}
            </select>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setChain((c) => c.filter((_, j) => j !== i))}
            >
              <IconClose className="size-3.5" />
            </Button>
          </div>
        ))}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={chain.length >= 3}
            onClick={() =>
              setChain((c) => [
                ...c,
                models[0]
                  ? { kind: "model", fileName: models[0].fileName }
                  : { kind: "tag", name: otherTags[0]?.name ?? "default" },
              ])
            }
          >
            <IconAdd className="size-3.5" /> Add fallback
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => run(() => setFallback(tag.name, chain))}
          >
            Save chain
          </Button>
        </div>
      </div>
    </div>
  );
}
