export type MessageRole = "user" | "assistant";

// generating = in-flight stream; partial = stopped or recovered after crash;
// failed = inference error (content retains what was generated)
export type MessageStatus = "generating" | "complete" | "partial" | "failed";

export type ModelStatus = "unloaded" | "loading" | "ready" | "error";

export interface MessageStats {
  tokens: number;
  tokensPerSec: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  createdAt: string;
  completedAt: string | null;
  stats?: MessageStats | null;
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

export interface GenerationParams {
  temperature: number; // 0.0-2.0; 0 = greedy
  topP: number; // 0.0-1.0; 1 = off
  topK: number; // >=0; 0 = off
  repeatPenalty: number; // >=0; 1 = off
  seed: number; // uint32; 0 = random
  maxTokens: number; // >=0; 0 = context-bound
  nThreads: number; // >=0; 0 = default
  nGpuLayers: number; // >=0; 0 = CPU
}

export const DEFAULT_GENERATION: GenerationParams = {
  temperature: 0,
  topP: 1,
  topK: 0,
  repeatPenalty: 1,
  seed: 0,
  maxTokens: 512,
  nThreads: 0,
  nGpuLayers: 0,
};

export interface ModelMeta {
  path: string;
  fileName: string;
  sizeBytes: number;
  name: string | null;
  architecture: string | null;
  paramCount: string | null;
  quantization: string | null;
  contextTrain: number | null;
}

export type DownloadPhase = "progress" | "done" | "error";

export interface DownloadState {
  fileName: string;
  phase: DownloadPhase;
  downloadedBytes: number;
  totalBytes: number | null;
  error?: string;
}

export interface Settings {
  activeModelPath: string | null;
  contextLimitWarning: boolean;
  generation: GenerationParams;
  // per-model overrides keyed by model file basename
  modelOverrides: Record<string, Partial<GenerationParams>>;
}
