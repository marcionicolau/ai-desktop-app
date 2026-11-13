// feature 006 (T011/T013): persona CRUD + snippet CRUD in one settings
// surface, mirroring RolesPanel. Personas carry a system prompt, optional
// generation overrides and a preferred tag; snippets are composer "/"
// insert fragments.
import { useId, useRef } from "react";
import { SelectField } from "@/components/select-field";
import { Badge } from "@/components/ui/badge";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ParamField } from "../settings/ParamField";
import { specFor } from "../settings/param-spec";
import { useUnsavedGuard } from "../settings/use-unsaved-guard";
import { MAX_PROMPT_BYTES, validatePersonaDraft, validateSnippet } from "./persona-rules";
import { confirm } from "@/lib/confirm";
import { useState } from "react";
import { IconAdd, IconCopy, IconDelete, IconEdit, IconUsers } from "@/components/icons";
import type { Persona, Snippet } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { usePersonas } from "./use-personas";
import { useRoles } from "../roles/use-roles";

const PARAM_FIELDS = [
  { key: "temperature", label: "temp", step: "0.1" },
  { key: "topP", label: "topP", step: "0.05" },
  { key: "maxTokens", label: "maxTok", step: "1" },
] as const;

interface Draft {
  name: string;
  systemPrompt: string;
  temperature: string;
  topP: string;
  maxTokens: string;
  preferredTag: string;
}

const EMPTY: Draft = {
  name: "",
  systemPrompt: "",
  temperature: "",
  topP: "",
  maxTokens: "",
  preferredTag: "",
};

const toDraft = (p: Persona, name?: string): Draft => ({
  name: name ?? p.name,
  systemPrompt: p.systemPrompt,
  temperature: p.params?.temperature?.toString() ?? "",
  topP: p.params?.topP?.toString() ?? "",
  maxTokens: p.params?.maxTokens?.toString() ?? "",
  preferredTag: p.preferredTag ?? "",
});

const toPersona = (d: Draft): Persona => {
  const params: Record<string, number> = {};
  for (const f of PARAM_FIELDS) {
    const raw = d[f.key].trim();
    if (raw !== "") params[f.key] = Number(raw);
  }
  return {
    name: d.name.trim(),
    systemPrompt: d.systemPrompt,
    params: Object.keys(params).length ? params : null,
    ...(d.preferredTag ? { preferredTag: d.preferredTag } : {}),
  };
};

export function PersonasPanel() {
  const {
    personas,
    snippets,
    upsert,
    remove,
    usage,
    upsertSnippet,
    removeSnippet,
  } = usePersonas();
  const { tags } = useRoles();
  const [draft, setDraft] = useState<Draft | null>(null); // null = no editor
  const [editing, setEditing] = useState<string | null>(null); // "" = new
  const [snip, setSnip] = useState<Snippet>({ name: "", text: "" });
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    void fn().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  };

  const savePersona = () =>
    run(async () => {
      if (!draft) return;
      await upsert(toPersona(draft));
      setDraft(null);
      setEditing(null);
    });

  const duplicate = (p: Persona) => {
    setEditing(""); // new-name flow under a fresh slug
    setDraft(toDraft(p, `${p.name}-copy`));
  };

  const del = (p: Persona) =>
    run(async () => {
      const u = await usage(p.name);
      const note =
        u.count > 0
          ? ` It is in use by ${u.count} conversation(s) (${u.titles.join(", ")}); they keep working with default behavior.`
          : "";
      const ok = await confirm({
        title: "Delete persona",
        itemName: p.name,
        consequence: `The persona is removed.${note}`,
      });
      if (!ok) return;
      await remove(p.name);
    });

  return (
    <div className="border-b border-border bg-muted/40 px-4 py-3">
      <div className="mx-auto max-w-2xl space-y-3">
        <div className="flex items-center gap-2">
          <IconUsers className="size-4 text-muted-foreground" />
          <h2 className="text-xs font-semibold">Personas</h2>
          <span className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing("");
              setDraft({ ...EMPTY });
            }}
          >
            <IconAdd className="size-3.5" /> New persona
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="divide-y divide-border text-xs">
          {personas.map((p) => (
            <div key={p.name} className="py-(--row-pad)">
              <div className="flex items-center gap-2">
                <span className="font-medium">{p.name}</span>
                {p.preferredTag && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
                    → {p.preferredTag}
                  </span>
                )}
                <span className="flex-1 truncate text-muted-foreground">
                  {p.systemPrompt}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  title="Edit"
                  onClick={() => {
                    setEditing(p.name);
                    setDraft(toDraft(p));
                  }}
                >
                  <IconEdit className="size-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  title="Duplicate"
                  onClick={() => duplicate(p)}
                >
                  <IconCopy className="size-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  title="Delete"
                  onClick={() => del(p)}
                >
                  <IconDelete className="size-3.5" />
                </Button>
              </div>
              {editing === p.name && draft && (
                <PersonaEditor
                  draft={draft}
                  setDraft={setDraft}
                  tags={tags.map((t) => t.name)}
                  nameLocked
                  onSave={savePersona}
                  onCancel={() => {
                    setEditing(null);
                    setDraft(null);
                  }}
                />
              )}
            </div>
          ))}
        </div>
        {editing === "" && draft && (
          <PersonaEditor
            draft={draft}
            setDraft={setDraft}
            tags={tags.map((t) => t.name)}
            onSave={savePersona}
            onCancel={() => {
              setEditing(null);
              setDraft(null);
            }}
          />
        )}
        <h3 className="pt-2 text-xs font-semibold">Snippets</h3>
        <div className="divide-y divide-border text-xs">
          {snippets.map((s) => (
            <div key={s.name} className="flex items-center gap-2 py-2">
              <span className="font-medium">/{s.name}</span>
              <span className="flex-1 truncate text-muted-foreground">
                {s.text}
              </span>
              <Button
                size="sm"
                variant="ghost"
                title="Delete snippet"
                onClick={() =>
                  run(async () => {
                    const ok = await confirm({
                      title: "Delete snippet",
                      itemName: s.name,
                      consequence: "The snippet is removed from the / picker.",
                    });
                    if (ok) await removeSnippet(s.name);
                  })
                }
              >
                <IconDelete className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
        {(() => {
          const errs = validateSnippet(snip.name, snip.text);
          const nameErr = snip.name !== "" ? errs.name : undefined;
          const textErr = snip.text !== "" ? errs.text : undefined;
          const valid = Object.keys(errs).length === 0;
          return (
            <form
              className="flex flex-wrap items-start gap-3"
              aria-label="New snippet"
              onSubmit={(e) => {
                e.preventDefault();
                if (!valid) return;
                run(async () => {
                  await upsertSnippet({ name: snip.name.trim(), text: snip.text });
                  setSnip({ name: "", text: "" });
                });
              }}
            >
              <Field className="w-44" data-invalid={nameErr ? true : undefined}>
                <FieldLabel htmlFor="snippet-name">Snippet name</FieldLabel>
                <Input
                  id="snippet-name"
                  placeholder="fix-bug"
                  value={snip.name}
                  onChange={(e) => setSnip({ ...snip, name: e.target.value })}
                  aria-invalid={nameErr ? true : undefined}
                  className="text-sm"
                />
                {nameErr && <FieldError>{nameErr}</FieldError>}
              </Field>
              <Field className="min-w-48 flex-1" data-invalid={textErr ? true : undefined}>
                <FieldLabel htmlFor="snippet-text">Text inserted by /name</FieldLabel>
                <Input
                  id="snippet-text"
                  placeholder="Explain this error and suggest a fix…"
                  value={snip.text}
                  onChange={(e) => setSnip({ ...snip, text: e.target.value })}
                  aria-invalid={textErr ? true : undefined}
                  className="text-sm"
                />
                {textErr && <FieldError>{textErr}</FieldError>}
              </Field>
              <Button type="submit" size="sm" className="mt-6" disabled={!valid}>
                <IconAdd className="size-3.5" /> Add
              </Button>
            </form>
          );
        })()}
      </div>
    </div>
  );
}

function PersonaEditor({
  draft,
  setDraft,
  tags,
  nameLocked,
  onSave,
  onCancel,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  tags: string[];
  nameLocked?: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const uid = useId();
  // the draft as the editor opened: what "unsaved" is measured against
  const baseline = useRef(draft).current;
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useUnsavedGuard(`persona:${uid}`, `Persona ${draft.name || "(new)"}`, dirty);

  const [attempted, setAttempted] = useState(false);
  const errors = validatePersonaDraft(draft);
  // "required" messages wait for a save attempt; format/range errors show as you type
  const shown = (k: keyof typeof errors) =>
    errors[k] && (attempted || draft[k as keyof Draft] !== "") ? errors[k] : undefined;
  const promptBytes = new TextEncoder().encode(draft.systemPrompt).length;

  const trySave = () => {
    if (Object.keys(errors).length > 0) {
      setAttempted(true);
      return;
    }
    onSave();
  };
  const cancel = async () => {
    if (dirty) {
      const ok = await confirm({
        title: "Discard changes?",
        itemName: draft.name || "New persona",
        consequence: "Your edits to this persona will be lost.",
        confirmLabel: "Discard",
      });
      if (!ok) return;
    }
    onCancel();
  };

  return (
    <form
      className="mt-2 space-y-3 rounded border border-border bg-background p-3"
      aria-label={nameLocked ? `Edit persona ${draft.name}` : "New persona"}
      onSubmit={(e) => {
        e.preventDefault();
        trySave();
      }}
    >
      <FieldGroup className="gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field data-invalid={shown("name") ? true : undefined}>
            <FieldLabel htmlFor={`${uid}-name`}>Name</FieldLabel>
            <Input
              id={`${uid}-name`}
              placeholder="code-review"
              value={draft.name}
              disabled={nameLocked}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              aria-invalid={shown("name") ? true : undefined}
              className="text-sm"
            />
            <FieldDescription>
              Lowercase letters, numbers and dashes. Typed as /{draft.name || "name"} in the message box.
            </FieldDescription>
            {shown("name") && <FieldError>{shown("name")}</FieldError>}
          </Field>
          <Field>
            <FieldLabel htmlFor={`${uid}-tag`}>Preferred role</FieldLabel>
            <SelectField
              id={`${uid}-tag`}
              value={draft.preferredTag}
              options={[
                { value: "", label: "No preferred role" },
                ...tags.map((t) => ({ value: t, label: `→ ${t}` })),
              ]}
              onValueChange={(v) => setDraft({ ...draft, preferredTag: v })}
            />
            <FieldDescription>Offered when you pick this persona in a chat.</FieldDescription>
          </Field>
        </div>

        <Field data-invalid={shown("systemPrompt") ? true : undefined}>
          <FieldLabel htmlFor={`${uid}-prompt`}>System prompt</FieldLabel>
          <Textarea
            id={`${uid}-prompt`}
            placeholder="Instructions added to every turn…"
            value={draft.systemPrompt}
            onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
            aria-invalid={shown("systemPrompt") ? true : undefined}
            rows={4}
            className="resize-y text-sm"
          />
          <FieldDescription>
            {promptBytes} / {MAX_PROMPT_BYTES} bytes
          </FieldDescription>
          {shown("systemPrompt") && <FieldError>{shown("systemPrompt")}</FieldError>}
        </Field>

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Generation overrides — leave empty to inherit
          </p>
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
            {PARAM_FIELDS.map((f) => (
              <ParamField
                key={f.key}
                spec={specFor(f.key)}
                value={draft[f.key]}
                onChange={(text) => setDraft({ ...draft, [f.key]: text })}
                error={shown(f.key)}
              />
            ))}
          </div>
        </div>
      </FieldGroup>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {dirty && <Badge variant="warning">Unsaved changes</Badge>}
        <Button type="button" size="sm" variant="ghost" onClick={() => void cancel()}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          Save
        </Button>
      </div>
    </form>
  );
}
