// feature 017: production ViewFactory — builds the isolated BrowserView an
// extension view lives in (research D2). Electrobun imports are deferred
// with require() inside the factory so handlers.ts stays importable in
// headless test contexts (the FFI libs only exist under `electrobun dev`).
//
// Isolation: per-pack partition + viewsRoot locked to the pack dir + the
// view's rpc object is an ExtViewRpcSchema — pack JS can ONLY reach the
// capability-gated ext.* handlers (FR-013/FR-014). The injected preload
// (EXT_PRELOAD_JS) exposes window.ext on top of the standard host bridge.
import type { ExtViewRpcSchema } from "../../shared/ext-view-contract";
import { EXT_PRELOAD_JS } from "./preload";
import type { BrowserViewLike, ViewFactory } from "./views";

export interface HostTarget {
  windowId: number;
  webviewId?: number;
}

type MainApi = typeof import("electrobun/main");
type NativeApi = typeof import("../../../.hutch/devkit/api/sdks/main/proc/native");

// getHost resolves the main window lazily — the window is created after
// createRpc() in index.ts.
export function electrobunViewFactory(getHost: () => HostTarget | null): ViewFactory {
  return (opts) => {
    const host = getHost();
    if (!host) return { id: -1 };
    const { BrowserView } = require("electrobun/main") as MainApi;
    const { ffi } = require("../../../.hutch/devkit/api/sdks/main/proc/native") as NativeApi;
    const viewRpc = BrowserView.defineRPC<ExtViewRpcSchema>({
      handlers: { requests: opts.bridge, messages: {} },
    });
    const rel = opts.entry.startsWith(opts.viewsRoot + "/")
      ? opts.entry.slice(opts.viewsRoot.length + 1)
      : opts.entry;
    const view = new BrowserView({
      url: `views://${rel}`,
      viewsRoot: opts.viewsRoot,
      partition: opts.partition,
      preload: EXT_PRELOAD_JS,
      windowId: host.windowId,
      hostWebviewId: host.webviewId,
      autoResize: false,
      allowedProtocols: { views: true, appData: false },
      rpc: viewRpc as never,
    });
    const like: BrowserViewLike = {
      id: view.id,
      setBounds: (frame) => {
        view.frame = frame;
        try {
          ffi.request.resizeWebview({ id: view.id, frame, masks: "[]" });
        } catch {
          // view already gone — renderer will close the session
        }
      },
      send: (method, payload) => {
        try {
          (viewRpc.send as CallableFunction)(method, payload);
        } catch {
          // transport not attached yet
        }
      },
      remove: () => view.remove(),
    };
    // T052 (FR-013/FR-014): extension views may only load views:// pack
    // assets — any remote navigation is forced back to the entry page
    view.on("did-navigate", (event) => {
      const detail = (event as { detail?: { url?: string } }).detail;
      if (detail?.url && !detail.url.startsWith("views://")) {
        try {
          view.loadURL(`views://${rel}`);
        } catch {
          // view already gone
        }
      }
    });
    view.on("dom-ready", () => undefined);
    return like;
  };
}
