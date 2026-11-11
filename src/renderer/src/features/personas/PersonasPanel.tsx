// feature 006 (T011/T013): persona CRUD + snippet CRUD in one settings
// surface, mirroring RolesPanel. Personas carry a system prompt, optional
// generation overrides and a preferred tag; snippets are composer "/"
// insert fragments.
import { useState } from "react";
import { Copy, Pencil, Plus, Trash2, Users } from "lucide-react";
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
          ? `\n\nIn use by ${u.count} conversation(s): ${u.titles.join(", ")}. They keep working with default behavior.`
          : "";
      if (!window.confirm(`Delete persona "${p.name}"?${note}`)) return;
      await remove(p.name);
    });

  return (
    <div className="border-b border-border bg-muted/40 px-4 py-3">
      <div className="mx-auto max-w-2xl space-y-3">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-muted-foreground" />
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
            <Plus className="size-3.5" /> New persona
          </Button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="divide-y divide-border text-xs">
          {personas.map((p) => (
            <div key={p.name} className="py-2">
              <div className="flex items-center gap-2">
                <span className="font-medium">{p.name}</span>
                {p.preferredTag && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
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
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  title="Duplicate"
                  onClick={() => duplicate(p)}
                >
                  <Copy className="size-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  title="Delete"
                  onClick={() => del(p)}
                >
                  <Trash2 className="size-3.5" />
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
                onClick={() => run(() => removeSnippet(s.name))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="snippet-name"
            value={snip.name}
            onChange={(e) => setSnip({ ...snip, name: e.target.value })}
            className="h-8 w-40 text-xs"
          />
          <Input
            placeholder="Text inserted by /name…"
            value={snip.text}
            onChange={(e) => setSnip({ ...snip, text: e.target.value })}
            className="h-8 flex-1 text-xs"
          />
          <Button
            size="sm"
            disabled={!snip.name.trim() || !snip.text.trim()}
            onClick={() =>
              run(async () => {
                await upsertSnippet({
                  name: snip.name.trim(),
                  text: snip.text,
                });
                setSnip({ name: "", text: "" });
              })
            }
          >
            <Plus className="size-3.5" /> Add
          </Button>
        </div>
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
  return (
    <div className="mt-2 space-y-2 rounded border border-border bg-background p-2">
      <div className="flex items-center gap-2">
        <Input
          placeholder="persona-name"
          value={draft.name}
          disabled={nameLocked}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="h-8 w-48 text-xs"
        />
        <select
          value={draft.preferredTag}
          onChange={(e) =>
            setDraft({ ...draft, preferredTag: e.target.value })
          }
          className="h-8 rounded border border-border bg-background px-2 text-xs"
          title="Preferred role tag"
        >
          <option value="">no preferred tag</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              → {t}
            </option>
          ))}
        </select>
        <span className="flex-1" />
        {PARAM_FIELDS.map((f) => (
          <Input
            key={f.key}
            placeholder={f.label}
            title={f.key}
            value={draft[f.key]}
            onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
            className="h-8 w-16 text-xs"
            inputMode="decimal"
          />
        ))}
      </div>
      <Textarea
        placeholder="System prompt injected into every turn…"
        value={draft.systemPrompt}
        onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
        rows={3}
        className="resize-none text-xs"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!draft.name.trim() || !draft.systemPrompt.trim()}
          onClick={onSave}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
