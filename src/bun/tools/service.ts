// feature 015: tool policy + approval state (research D5/D9).
// Policy is global settings; the session grant is per-conversation and
// in-memory only — it applies only within the granting conversation and
// dies with the process.
import type { Settings, ToolPolicy } from "../../shared/types";
import { Sandbox } from "./sandbox";

export type ToolDecision = "approve" | "deny" | "allowSession" | "discard";

const DEFAULT_POLICY: ToolPolicy = { sandboxRoot: null, mode: "deny" };

interface PendingCall {
  callId: string;
  messageId: string;
  conversationId: string;
  resolve: (d: ToolDecision) => void;
}

export class ToolService {
  private grants = new Map<string, true>(); // conversationId -> allowed
  private pending = new Map<string, PendingCall>(); // callId -> deferred
  private sandboxCache: { root: string; sandbox: Sandbox } | null = null;

  constructor(private deps: { getSettings(): Settings }) {}

  policy(): ToolPolicy {
    return { ...DEFAULT_POLICY, ...this.deps.getSettings().tools };
  }

  // tools run only with a configured root and a non-deny mode (FR-012
  // gate is upstream of prompt assembly via this same check)
  active(): boolean {
    const p = this.policy();
    return p.sandboxRoot !== null && p.mode !== "deny";
  }

  // canonicalized sandbox for the configured root; null when the root
  // is unset or no longer exists on disk (treated as inactive)
  sandbox(): Sandbox | null {
    const root = this.policy().sandboxRoot;
    if (root === null) return null;
    if (this.sandboxCache?.root === root) return this.sandboxCache.sandbox;
    try {
      const sandbox = new Sandbox(root);
      this.sandboxCache = { root, sandbox };
      return sandbox;
    } catch {
      return null;
    }
  }

  // skip the prompt for this conversation?
  autoApprove(conversationId: string): boolean {
    return (
      this.policy().mode === "allow-read-session" ||
      this.grants.has(conversationId)
    );
  }

  grantSession(conversationId: string): void {
    this.grants.set(conversationId, true);
  }

  // --- pending-call deferral ---

  awaitDecision(
    callId: string,
    messageId: string,
    conversationId: string,
  ): Promise<ToolDecision> {
    return new Promise((resolve) => {
      this.pending.set(callId, { callId, messageId, conversationId, resolve });
    });
  }

  // tool.respond: resolve a pending call; false when nothing is pending
  // under that id (-> NOT_FOUND)
  respond(callId: string, decision: Exclude<ToolDecision, "discard">): boolean {
    const p = this.pending.get(callId);
    if (!p) return false;
    this.pending.delete(callId);
    if (decision === "allowSession") this.grantSession(p.conversationId);
    p.resolve(decision);
    return true;
  }

  // chat.stop / turn teardown: resolve any pending calls for a message
  // as discarded so awaiting loops end the turn
  discardPending(messageId: string): void {
    for (const [id, p] of this.pending) {
      if (p.messageId === messageId) {
        this.pending.delete(id);
        p.resolve("discard");
      }
    }
  }

  hasPending(messageId?: string): boolean {
    for (const p of this.pending.values()) {
      if (messageId === undefined || p.messageId === messageId) return true;
    }
    return false;
  }
}
