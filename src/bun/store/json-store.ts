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
  Settings,
} from "../../shared/types";
import { conversationsDir, settingsFile } from "./paths";

const ID_RE = /^[\w-]+$/;

const DEFAULT_SETTINGS: Settings = {
  activeModelPath: null,
  contextLimitWarning: false,
};

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
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
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
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
    return conv;
  } catch {
    return null;
  }
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
