// Import validation + id remapping (feature 008).
// Every check throws INVALID_PARAMS before any write — zero partial
// writes (FR-006). Id remapping is collision-safe by construction (D3).
import {
  EXPORT_APP,
  EXPORT_FORMAT_VERSION,
  type ExportEnvelope,
  type ExportedSettings,
} from "../../shared/export";
import type {
  Conversation,
  Message,
  ModelTag,
  Settings,
} from "../../shared/types";
import { EngineError } from "../llama/engine";
import { existsSync } from "node:fs";
import { join } from "node:path";

const bad = (msg: string): never => {
  throw new EngineError("INVALID_PARAMS", msg);
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function parseEnvelope(raw: string): ExportEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    bad("not a JSON file");
  }
  if (!isObj(parsed)) bad("export file is not a JSON object");
  const env = parsed as Record<string, unknown>;
  if (env.formatVersion !== EXPORT_FORMAT_VERSION) {
    bad(`unsupported format version ${String(env.formatVersion)}`);
  }
  if (env.app !== EXPORT_APP) bad("not an ai-desktop-app export");
  if (env.kind !== "conversation" && env.kind !== "backup") {
    bad(`unknown export kind: ${String(env.kind)}`);
  }
  if (!Array.isArray(env.conversations) || env.conversations.length === 0) {
    bad("no conversations in file");
  }
  for (const [ci, rawConv] of (env.conversations as unknown[]).entries()) {
    if (!isObj(rawConv) || !Array.isArray(rawConv.messages)) {
      bad(`malformed conversation at index ${ci}`);
    }
    const conv = rawConv as { messages: unknown[] };
    for (const [mi, m] of conv.messages.entries()) {
      if (
        !isObj(m) ||
        typeof m.id !== "string" ||
        (m.role !== "user" && m.role !== "assistant") ||
        typeof m.content !== "string" ||
        typeof m.status !== "string"
      ) {
        bad(`malformed message at index ${mi}`);
      }
    }
  }
  return env as unknown as ExportEnvelope;
}

// every message gets a fresh id; parentId/activeLeaf rewrite through the
// map, dangling refs -> null (D3)
export function remapConversation(
  conv: Conversation,
  titleTaken: boolean,
): Conversation {
  const idMap = new Map<string, string>();
  for (const m of conv.messages) {
    idMap.set(m.id, crypto.randomUUID());
  }
  const remap = (id: string | null | undefined): string | null =>
    id != null ? (idMap.get(id) ?? null) : null;
  const messages: Message[] = conv.messages.map((m) => ({
    ...m,
    id: idMap.get(m.id)!,
    conversationId: "<set-below>",
    parentId: remap(m.parentId),
  }));
  const newId = crypto.randomUUID();
  for (const m of messages) m.conversationId = newId;
  const activeLeaf =
    remap(conv.activeLeaf) ?? messages.at(-1)?.id ?? null;
  return {
    ...conv,
    id: newId,
    title: titleTaken ? `${conv.title} (imported)` : conv.title,
    updatedAt: new Date().toISOString(),
    messages,
    activeLeaf,
  };
}

// basename -> absolute path only when the model file exists locally;
// absent bindings stay bound and surface as "broken" (FR-008)
export function toSettings(
  imported: ExportedSettings,
  tags: ModelTag[],
  modelsDir: string,
  provisioned: ModelTag[],
): Settings {
  const names = new Set(tags.map((t) => t.name));
  const mergedTags = [
    ...tags,
    ...provisioned.filter((p) => !names.has(p.name)),
  ];
  const activePath =
    imported.activeModel &&
    existsSync(join(modelsDir, imported.activeModel))
      ? join(modelsDir, imported.activeModel)
      : null;
  return {
    activeModelPath: activePath,
    contextLimitWarning: imported.contextLimitWarning,
    generation: imported.generation,
    modelOverrides: imported.modelOverrides,
    tags: mergedTags,
  };
}
