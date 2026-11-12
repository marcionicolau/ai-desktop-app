// feature 017: the ONLY RPC surface an extension BrowserView ever sees
// (contracts/view-bridge.md). Pack JS calls window.ext.<method>; each
// handler is capability-gated main-side (FR-014).
import type { ElectrobunRPCSchema } from "electrobun/main/rpc";
import type { RunRecord, RunSummary } from "./types";

export interface ExtContext {
  packId: string;
  viewId: string;
  theme: { mode: "light" | "dark"; vars: Record<string, string> };
  locale: string;
}

export interface ExtViewRpcSchema extends ElectrobunRPCSchema {
  bun: {
    requests: {
      "ext.context": { params: Record<string, never>; response: ExtContext };
      "ext.storage.get": { params: { key: string }; response: { value: unknown } };
      "ext.storage.set": { params: { key: string; value: unknown }; response: Record<string, never> };
      "ext.storage.remove": { params: { key: string }; response: Record<string, never> };
      "ext.runs.list": { params: Record<string, never>; response: { runs: RunSummary[] } };
      "ext.runs.get": { params: { runId: string }; response: { run: RunRecord | null } };
      "ext.invoke": { params: { commandId: string; args?: Record<string, unknown> }; response: { runId: string } };
      "ext.models.generate": {
        params: { prompt: string; params?: Record<string, unknown> };
        response: { text: string; usage: { promptTokens?: number; outputTokens: number } };
      };
    };
    messages: Record<string, never>;
  };
  webview: {
    requests: Record<string, never>;
    messages: {
      "ext.themeChanged": { theme: ExtContext["theme"] };
      "ext.runUpdated": { runId: string; status: string };
      "ext.contextChanged": { locale?: string };
    };
  };
}
