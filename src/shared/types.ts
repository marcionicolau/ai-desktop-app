export type MessageRole = "user" | "assistant";

// generating = in-flight stream; partial = stopped or recovered after crash;
// failed = inference error (content retains what was generated)
export type MessageStatus = "generating" | "complete" | "partial" | "failed";

export type ModelStatus = "unloaded" | "loading" | "ready" | "error";

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  createdAt: string;
  completedAt: string | null;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface ModelInfo {
  path: string;
  name: string;
  status: ModelStatus;
  error: string | null;
}

export interface Settings {
  activeModelPath: string | null;
  contextLimitWarning: boolean;
}
