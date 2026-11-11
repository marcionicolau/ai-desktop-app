// Typed RPC client (contracts/rpc.md). Only invoke/subscribe APIs are exposed;
// no raw bridge calls elsewhere in the renderer.
import { Electroview } from "electrobun/view";
import type { ChatRpcSchema } from "@shared/rpc-contract";

type Events = ChatRpcSchema["webview"]["messages"];
type Handler<M extends keyof Events> = (payload: Events[M]) => void;
type AnyHandler = (payload: Events[keyof Events]) => void;

const listeners = new Map<keyof Events, Set<AnyHandler>>();

function dispatch<M extends keyof Events>(method: M, payload: Events[M]) {
  listeners.get(method)?.forEach((h) => h(payload));
}

export const rpc = Electroview.defineRPC<ChatRpcSchema>({
  handlers: {
    messages: {
      "chat.token": (p) => dispatch("chat.token", p),
      "chat.done": (p) => dispatch("chat.done", p),
      "chat.error": (p) => dispatch("chat.error", p),
      "model.progress": (p) => dispatch("model.progress", p),
      "chat.warning": (p) => dispatch("chat.warning", p),
    },
    requests: {},
  },
});

export function on<M extends keyof Events>(
  method: M,
  handler: Handler<M>,
): () => void {
  let set = listeners.get(method);
  if (!set) {
    set = new Set();
    listeners.set(method, set);
  }
  const h = handler as AnyHandler;
  set.add(h);
  return () => set.delete(h);
}

// Invoke a request method; params/response types come from the schema.
export const invoke = rpc.request.bind(rpc) as <
  M extends keyof ChatRpcSchema["bun"]["requests"],
>(
  method: M,
  params: ChatRpcSchema["bun"]["requests"][M]["params"],
) => Promise<ChatRpcSchema["bun"]["requests"][M]["response"]>;
