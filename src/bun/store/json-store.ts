// JSON document store: conversations + settings, atomic writes via
// tmp-then-rename. Layout per data-model.md.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type {
  Conversation,
  ConversationSummary,
  ModelTag,
  Settings,
} from "../../shared/types";
import { DEFAULT_GENERATION } from "../../shared/types";
import { conversationsDir, settingsFile } from "./paths";

const ID_RE = /^[\w-]+$/;

const DEFAULT_SETTINGS: Settings = {
  activeModelPath: null,
  contextLimitWarning: false,
  generation: DEFAULT_GENERATION,
  modelOverrides: {},
  tags: [],
};

function newTag(name: string, label: string, description: string): ModelTag {
  return { name, label, description, binding: null, params: {}, fallback: [] };
}

// provisioned on first load; "default" binds to the active model (FR-010)
function provisionTags(settings: Settings): ModelTag[] {
  const defaults: ModelTag[] = [
    {
      ...newTag("default", "Default", "single-mode chat model"),
      binding: settings.activeModelPath
        ? settings.activeModelPath.split("/").pop()!
        : null,
    },
    newTag("planner", "Planner", "fusion planning phase"),
    newTag("executor", "Executor", "fusion answering phase"),
  ];
  if (!settings.tags || settings.tags.length === 0) return defaults;
  // ensure the built-in tags exist even if tags were stored before
  const names = new Set(settings.tags.map((t) => t.name));
  return [...settings.tags, ...defaults.filter((d) => !names.has(d.name))];
}

function atomicWrite(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, file);
}

function conversationPath(id: string): string {
  if (!ID_RE.test(id)) {
    throw new Error(`invalid conversation id: ${id}`);
  }
  return join(conversationsDir(), `${id}.json`);
}

export function getSettings(): Settings {
  try {
    const raw = readFileSync(settingsFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged: Settings = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      generation: { ...DEFAULT_GENERATION, ...parsed.generation },
      modelOverrides: parsed.modelOverrides ?? {},
      tags: parsed.tags ?? [],
    };
    return { ...merged, tags: provisionTags(merged) };
  } catch {
    const fresh: Settings = {
      ...DEFAULT_SETTINGS,
      generation: { ...DEFAULT_GENERATION },
    };
    return { ...fresh, tags: provisionTags(fresh) };
  }
}

export function saveSettings(settings: Settings): void {
  atomicWrite(settingsFile(), settings);
}

export function listConversations(): ConversationSummary[] {
  const dir = conversationsDir();
  if (!existsSync(dir)) return [];
  const out: ConversationSummary[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    try {
      const conv = JSON.parse(
        readFileSync(join(dir, entry), "utf8"),
      ) as Conversation;
      out.push({ id: conv.id, title: conv.title, updatedAt: conv.updatedAt });
    } catch {
      // skip unreadable/corrupt files
    }
  }
  return out.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getConversation(id: string): Conversation | null {
  try {
    const conv = JSON.parse(
      readFileSync(conversationPath(id), "utf8"),
    ) as Conversation;
    // crash recovery: messages still "generating" at last shutdown are
    // restored as "partial" (data-model.md state transitions)
    for (const m of conv.messages) {
      if (m.status === "generating") m.status = "partial";
    }
    // feature 004 defaults for pre-existing conversations
    conv.mode ??= "single";
    conv.plannerTag ??= "planner";
    conv.executorTag ??= "executor";
    // feature 005 lazy backfill (write-through on next save)
    backfillTree(conv);
    return conv;
  } catch {
    return null;
  }
}

// feature 005: pre-tree conversations get a linear parentId chain and
// activeLeaf = last message; already-migrated fields are preserved
export function backfillTree(conv: Conversation): void {
  let prev: string | null = null;
  for (const m of conv.messages) {
    // only ABSENT parentId is legacy — explicit null is a real root marker
    // (e.g. an edited root user variant); re-chaining it would corrupt the tree
    if (m.parentId === undefined) m.parentId = prev;
    prev = m.id;
  }
  conv.activeLeaf ??= conv.messages.at(-1)?.id ?? null;
}

export function saveConversation(conv: Conversation): void {
  atomicWrite(conversationPath(conv.id), conv);
}

export function deleteConversation(id: string): boolean {
  try {
    rmSync(conversationPath(id));
    return true;
  } catch {
    return false;
  }
}

// removes every message AFTER messageId in a conversation; powers
// chat.edit (delete-tail) and keeps the target itself intact.
// Returns false when the conversation or message is missing.
export function deleteMessagesAfter(
  conversationId: string,
  messageId: string,
): boolean {
  const conv = getConversation(conversationId);
  if (!conv) return false;
  const idx = conv.messages.findIndex((m) => m.id === messageId);
  if (idx < 0) return false;
  conv.messages.splice(idx + 1);
  conv.updatedAt = new Date().toISOString();
  saveConversation(conv);
  return true;
}
