// feature 017: host-shipped preload injected into every extension
// BrowserView. Exposes ONLY window.ext — a thin promise wrapper over the
// view's user-RPC channel (__electrobunHostBridge, plain JSON packets).
// Pack JS never sees Electrobun internals or the host RPC schema.
export const EXT_PRELOAD_JS = String.raw`
(() => {
  if (window.ext) return;
  let seq = 0;
  const pending = new Map();
  const listeners = new Map();
  const post = (pkt) =>
    window.__electrobunHostBridge?.postMessage(JSON.stringify(pkt));
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = "ext_" + ++seq + "_" + Date.now();
      pending.set(id, { resolve, reject });
      post({ type: "request", id, method, params: params ?? {} });
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error("ext request timed out"));
      }, 30000);
    });
  const on = (event, cb) => {
    let set = listeners.get(event);
    if (!set) listeners.set(event, (set = new Set()));
    set.add(cb);
    return () => set.delete(cb);
  };
  const prevReceive = window.__electrobun?.receiveMessageFromHost;
  window.__electrobun = window.__electrobun || {};
  window.__electrobun.receiveMessageFromHost = (msg) => {
    try {
      if (msg && msg.type === "response" && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.success === false) p.reject(new Error(msg.error || "ext error"));
        else p.resolve(msg.payload);
        return;
      }
      if (msg && msg.type === "message" && listeners.has(msg.id)) {
        listeners.get(msg.id).forEach((h) => h(msg.payload));
        return;
      }
    } catch (e) {
      console.error("ext bridge error", e);
    }
    return prevReceive?.(msg);
  };
  window.ext = {
    context: () => request("ext.context"),
    storage: {
      get: (key) => request("ext.storage.get", { key }),
      set: (key, value) => request("ext.storage.set", { key, value }),
      remove: (key) => request("ext.storage.remove", { key }),
    },
    runs: {
      list: () => request("ext.runs.list"),
      get: (runId) => request("ext.runs.get", { runId }),
    },
    invoke: (commandId, args) => request("ext.invoke", { commandId, args }),
    models: {
      generate: (prompt, params) => request("ext.models.generate", { prompt, params }),
    },
    on,
  };
})();
`;
