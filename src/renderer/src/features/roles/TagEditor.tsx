import { SelectField } from "@/components/select-field";
import { Badge } from "@/components/ui/badge";
import { FieldGroup } from "@/components/ui/field";
import { ParamField } from "../settings/ParamField";
import { draftErrors, draftToParams, PARAM_SPECS, paramsToDraft, sameDraft, type ParamDraft } from "../settings/param-spec";
import { useUnsavedGuard } from "../settings/use-unsaved-guard";
import { useState } from "react";
import { IconAdd, IconClose } from "@/components/icons";
import type { ModelMeta, RoleRef, RoleView } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRoles } from "./use-roles";

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
  const [draft, setDraft] = useState<ParamDraft>(() => paramsToDraft(tag.params));
  const errors = draftErrors(draft);
  const paramsDirty = !sameDraft(draft, paramsToDraft(tag.params));
  // FR-013: unsaved edits are visible and confirmed before an editor closes
  const detailsDirty = label !== (tag.label ?? "") || description !== (tag.description ?? "");
  useUnsavedGuard(`role:${tag.name}`, `Role ${tag.name}`, paramsDirty || detailsDirty);
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
        <SelectField
          aria-label={`Bound model for ${tag.name}`}
          className="flex-1"
          value={tag.binding ?? ""}
          options={[
            { value: "", label: "— unbound —" },
            ...models.map((m) => ({
              value: m.fileName,
              label: `${m.name ?? m.fileName} (${m.quantization ?? "?"})`,
            })),
          ]}
          onValueChange={(v) => run(() => bind(tag.name, v || null))}
        />
      </div>

      <div>
        <p className="mb-1 text-muted-foreground">
          Generation overrides — empty fields inherit global/model settings.
        </p>
        <FieldGroup className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {PARAM_SPECS.map((spec) => (
            <ParamField
              key={spec.key}
              spec={spec}
              value={draft[spec.key] ?? ""}
              onChange={(text) => setDraft((d) => ({ ...d, [spec.key]: text }))}
              error={errors[spec.key]}
              inheritedHint="inherit"
            />
          ))}
        </FieldGroup>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={Object.keys(errors).length > 0 || !paramsDirty}
            onClick={() => run(() => update({ name: tag.name, params: draftToParams(draft) }))}
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
          {(paramsDirty || detailsDirty) && <Badge variant="warning">Unsaved changes</Badge>}
          {Object.keys(errors).length > 0 && (
            <span className="text-xs text-destructive">Fix the highlighted fields to save.</span>
          )}
        </div>
      </div>

      <div>
        <p className="mb-1 text-muted-foreground">
          Fallback chain (max 3, tried in order when the binding fails).
        </p>
        {chain.map((r, i) => (
          <div key={i} className="mb-1 flex items-center gap-2">
            <SelectField
              aria-label={`Fallback ${i + 1} kind`}
              className="w-24"
              value={r.kind}
              options={[
                { value: "tag", label: "tag" },
                { value: "model", label: "model" },
              ]}
              onValueChange={(v) => {
                const kind = v as RoleRef["kind"];
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
            />
            <SelectField
              aria-label={`Fallback ${i + 1} target`}
              className="flex-1"
              value={r.kind === "tag" ? r.name : r.fileName}
              options={
                r.kind === "tag"
                  ? otherTags.map((o) => ({ value: o.name, label: o.label ?? o.name }))
                  : models.map((m) => ({ value: m.fileName, label: m.name ?? m.fileName }))
              }
              onValueChange={(v) =>
                setChain((c) =>
                  c.map((o, j) =>
                    j === i
                      ? o.kind === "tag"
                        ? { kind: "tag", name: v }
                        : { kind: "model", fileName: v }
                      : o,
                  ),
                )
              }
            />
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
