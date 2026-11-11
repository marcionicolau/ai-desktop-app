// Export envelope + Markdown transcript builders (feature 008).
// Pure functions — no file I/O; handlers own dialogs + writes.
import {
  EXPORT_APP,
  EXPORT_FORMAT_VERSION,
  type ExportEnvelope,
  type ExportedSettings,
} from "../../shared/export";
import type {
  Conversation,
  ModelTag,
  Settings,
} from "../../shared/types";
import { basename } from "node:path";
import { pathOf, variantIndex } from "../store/tree";

const now = () => new Date().toISOString();

// D2: machine-local paths never leave the machine — basenames only
export function toExportedSettings(s: Settings): ExportedSettings {
  return {
    generation: s.generation,
    modelOverrides: s.modelOverrides,
    contextLimitWarning: s.contextLimitWarning,
    activeModel: s.activeModelPath ? basename(s.activeModelPath) : null,
  };
}

export function buildEnvelope(conv: Conversation): ExportEnvelope {
  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    app: EXPORT_APP,
    kind: "conversation",
    exportedAt: now(),
    conversations: [conv],
  };
}

export function buildBackupEnvelope(
  conversations: Conversation[],
  settings: Settings,
  tags: ModelTag[],
): ExportEnvelope {
  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    app: EXPORT_APP,
    kind: "backup",
    exportedAt: now(),
    conversations,
    settings: toExportedSettings(settings),
    tags,
  };
}

const SPEAKER: Record<string, string> = { user: "**You**", assistant: "**Assistant**" };

// D4: human transcript = the ACTIVE path only; siblings surface as
// "(variant k of N)" markers; fusion plans render as <details> blocks
export function renderMarkdown(conv: Conversation): string {
  const out: string[] = [`# ${conv.title}`, ""];
  const path = pathOf(conv);
  for (const m of path) {
    const v = variantIndex(conv, m);
    const variantNote =
      v.total > 1 ? ` *(variant ${v.pos} of ${v.total} — others not shown)*` : "";
    const statusNote =
      m.status === "complete" ? "" : ` *(${m.status})*`;
    out.push(`${SPEAKER[m.role] ?? `**${m.role}**`} — ${m.createdAt}${variantNote}${statusNote}`);
    out.push("");
    if (m.phases?.plan) {
      const p = m.phases.plan;
      out.push(
        `<details><summary>Plan${p.tag ? ` — ${p.tag}` : ""}${p.fileName ? ` · ${p.fileName}` : ""}</summary>`,
        "",
        p.content,
        "",
        "</details>",
        "",
      );
    }
    out.push(m.content || "*(empty)*", "");
  }
  return out.join("\n");
}

const SLUG_RE = /[^a-z0-9]+/g;

export function slugify(title: string): string {
  const s = title.toLowerCase().replace(SLUG_RE, "-").replace(/^-+|-+$/g, "");
  return (s || "conversation").slice(0, 60);
}

// "<slug>-<id8>.<ext>", dedup with -2, -3… via `exists`
export function uniqueFileName(
  title: string,
  id: string,
  ext: string,
  exists: (name: string) => boolean,
): string {
  const base = `${slugify(title)}-${id.slice(0, 8)}`;
  let name = `${base}.${ext}`;
  for (let i = 2; exists(name); i++) name = `${base}-${i}.${ext}`;
  return name;
}
