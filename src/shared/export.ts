// Export/import wire types (feature 008). Single versioned envelope for
// both single-conversation and full-backup exports (research D1).
import type {
  Conversation,
  GenerationParams,
  ModelTag,
} from "./types";

export const EXPORT_FORMAT_VERSION = 1;
export const EXPORT_APP = "ai-desktop-app";

export type ExportKind = "conversation" | "backup";

// Conversation verbatim — parentId/activeLeaf/phases round-trip (005)
export type ExportedConversation = Conversation;

// path-free settings: activeModelPath reduced to a file basename (D2)
export interface ExportedSettings {
  generation: GenerationParams;
  modelOverrides: Record<string, Partial<GenerationParams>>;
  contextLimitWarning: boolean;
  activeModel: string | null;
}

export interface ExportEnvelope {
  formatVersion: number;
  app: typeof EXPORT_APP;
  kind: ExportKind;
  exportedAt: string;
  conversations: ExportedConversation[];
  settings?: ExportedSettings;
  tags?: ModelTag[];
}
