// feature 017: ViewManager — one isolated BrowserView per open extension
// view (research D2): per-pack partition, viewsRoot locked to the view
// dir, dedicated ext.* rpc, crash containment + reload (FR-013/FR-016).
// The BrowserView factory is injectable so tests run headless.
import { PackError } from "../fabric/errors";
import type { InstalledPackView } from "../../shared/types";
import type { ViewBridge } from "./bridge";

// Minimal shape we use — satisfied by Electrobun's BrowserView and by the
// fake injected in tests.
export interface BrowserViewLike {
  id: number;
  close?(): void;
  remove?(): void;
  setBounds?(frame: { x: number; y: number; width: number; height: number }): void;
  send?(method: string, payload: unknown): void;
}

export interface ViewFactoryOpts {
  packId: string;
  viewId: string;
  entry: string; // absolute path to the view's index.html
  viewsRoot: string; // view dir root — locked to pack dir
  partition: string;
  bridge: ViewBridge;
}

export type ViewFactory = (opts: ViewFactoryOpts) => BrowserViewLike;

export interface ViewSession {
  sessionId: string;
  packId: string;
  viewId: string;
  slot: "tab" | "panel";
  caps: ReadonlySet<string>;
  view: BrowserViewLike;
  crashed?: boolean;
}

export interface ViewManagerDeps {
  factory?: ViewFactory;
  onError?: (sessionId: string, message: string) => void;
}

// default factory is injected by the host (createRpc) so this module stays
// importable outside Electrobun; tests always pass a fake.
let counter = 0;

export class ViewManager {
  private sessions = new Map<string, ViewSession>();

  constructor(private deps: ViewManagerDeps) {}

  open(pack: InstalledPackView, viewId: string, bridge: ViewBridge): ViewSession {
    const decl = pack.manifest.contributions.views?.find((v) => v.id === viewId);
    if (!decl) {
      throw new PackError("CONTRIBUTION_NOT_FOUND", `pack "${pack.id}" has no view "${viewId}"`);
    }
    if (!this.deps.factory) {
      throw new PackError("ENGINE_ERROR", "no BrowserView factory (headless context)");
    }
    // one session per pack+view; reopening replaces (reload path, FR-016)
    const existing = [...this.sessions.values()].find((s) => s.packId === pack.id && s.viewId === viewId);
    if (existing) this.close(existing.sessionId);
    const view = this.deps.factory({
      packId: pack.id,
      viewId,
      entry: `${pack.dir}/${decl.entry}`,
      viewsRoot: pack.dir,
      partition: `persist:ext-${pack.id}`,
      bridge,
    });
    const session: ViewSession = {
      sessionId: `vs_${++counter}`,
      packId: pack.id,
      viewId,
      slot: decl.slot,
      caps: new Set(pack.manifest.capabilities),
      view,
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  close(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    try {
      if (s.view.close) s.view.close();
      else s.view.remove?.();
    } catch { /* already gone */ }
    this.sessions.delete(sessionId);
  }

  setBounds(sessionId: string, rect: { x: number; y: number; width: number; height: number }): void {
    const s = this.sessions.get(sessionId);
    if (!s) throw new PackError("NOT_FOUND", `no view session "${sessionId}"`);
    s.view.setBounds?.(rect);
  }

  // feature 019: hidden tabs keep their session alive but parked offscreen —
  // Electrobun BrowserView has no setVisible, only frame/remove (research D2).
  setVisible(sessionId: string, visible: boolean): void {
    const s = this.sessions.get(sessionId);
    if (!s) throw new PackError("NOT_FOUND", `no view session "${sessionId}"`);
    if (!visible) s.view.setBounds?.({ x: -10000, y: -10000, width: 1, height: 1 });
    // visible=true is a bounds no-op: the host's ResizeObserver re-pushes
  }

  get(sessionId: string): ViewSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  closeFor(packId: string): void {
    for (const s of this.sessions.values()) {
      if (s.packId === packId) this.close(s.sessionId);
    }
  }

  markCrashed(sessionId: string, message: string): void {
    const s = this.sessions.get(sessionId);
    if (s) s.crashed = true;
    this.deps.onError?.(sessionId, message);
  }

  // host→view push (theme/locale/run updates), capability checks happen
  // at emit-call sites (views.theme gate is the renderer's hint only)
  emitTo(sessionId: string, method: string, payload: unknown): void {
    this.sessions.get(sessionId)?.view.send?.(method, payload);
  }

  emitToPack(packId: string, method: string, payload: unknown): void {
    for (const s of this.sessions.values()) {
      if (s.packId === packId) s.view.send?.(method, payload);
    }
  }

  // FR-015: theme push only reaches views of packs that declared
  // views.theme — undeclared packs get nothing (deny by default)
  pushTheme(theme: { mode: "light" | "dark"; vars: Record<string, string> }): void {
    for (const s of this.sessions.values()) {
      if (s.caps.has("views.theme")) s.view.send?.("ext.themeChanged", { theme });
    }
  }
}
