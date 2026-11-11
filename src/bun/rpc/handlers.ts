// RPC handlers for the chat schema. Request handlers are stubs pending
// US1 (T020-T022) and US2 (T031+) tasks; the wiring + typing is final.
import { defineElectrobunRPC } from "electrobun/main/rpc";
import type { ChatRpcSchema, RpcErrorCode } from "../../shared/rpc-contract";
import { LlamaEngine, EngineError } from "../llama/engine";
import * as store from "../store/json-store";

const engine = new LlamaEngine();

function fail(code: RpcErrorCode, message: string): never {
  throw new EngineError(code, message);
}

export function createRpc() {
  return defineElectrobunRPC<ChatRpcSchema, "bun">("bun", {
    handlers: {
      requests: {
        "model.load": ({ path }) => {
          fail("ENGINE_ERROR", `model.load not implemented yet (path=${path})`);
        },
        "model.unload": () => ({}),
        "model.status": () => engine.status(),
        "chat.send": () => {
          fail("ENGINE_ERROR", "chat.send not implemented yet");
        },
        "chat.stop": () => {
          fail("NOT_GENERATING", "no generation active");
        },
        "conversation.list": () => store.listConversations(),
        "conversation.get": ({ conversationId }) => {
          const conv = store.getConversation(conversationId);
          if (!conv) fail("NOT_FOUND", `conversation ${conversationId} not found`);
          return conv;
        },
        "conversation.create": () => {
          fail("ENGINE_ERROR", "conversation.create not implemented yet");
        },
        "conversation.rename": () => {
          fail("ENGINE_ERROR", "conversation.rename not implemented yet");
        },
        "conversation.delete": ({ conversationId }) => {
          if (!store.deleteConversation(conversationId)) {
            fail("NOT_FOUND", `conversation ${conversationId} not found`);
          }
          return {};
        },
      },
      messages: {},
    },
  });
}

export { engine };
