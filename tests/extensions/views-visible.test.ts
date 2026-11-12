// feature 019 (T007): ViewManager.setVisible — hidden sessions park
// offscreen (BrowserView has no native setVisible); show is a bounds
// no-op; unknown sessions fail; idempotent.
import { describe, expect, test } from "bun:test";
import { ViewManager, type BrowserViewLike, type ViewFactoryOpts } from "../../src/bun/extensions/views";
import { createViewBridge } from "../../src/bun/extensions/bridge";
import type { InstalledPackView } from "../../src/shared/types";
import type { PackManifest } from "../../src/shared/pack-schema";

const manifest: PackManifest = {
  name: "views-pack",
  version: "1.0.0",
  apiLevel: 1,
  capabilities: [],
  contributions: {
    views: [
      { id: "explorer", title: "Explorer", slot: "tab", entry: "views/explorer/index.html" },
    ],
  },
};

const pack = (): InstalledPackView => ({
  id: "views-pack",
  dir: "/packs/views-pack",
  state: "enabled",
  source: { kind: "folder", ref: "/packs/views-pack" },
  manifest,
  installedAt: 0,
});

const bridge = (p: InstalledPackView) =>
  createViewBridge(p, "explorer", {
    engine: () => ({ generate: async () => ({ status: "complete" as const, tokens: 0 }), tokenCount: () => 0 }),
    runs: () => null,
    theme: () => ({ mode: "dark", vars: {} }),
    startRun: () => "r",
  });

function makeFactory() {
  const views: (BrowserViewLike & { bounds?: unknown })[] = [];
  const factory = (_opts: ViewFactoryOpts): BrowserViewLike => {
    const view: BrowserViewLike & { bounds?: unknown } = {
      id: views.length + 1,
      setBounds(frame) {
        view.bounds = frame;
      },
      remove() {},
    };
    views.push(view);
    return view;
  };
  return { views, factory };
}

describe("ViewManager.setVisible", () => {
  test("hide parks the view offscreen; show is a bounds no-op", () => {
    const { views, factory } = makeFactory();
    const mgr = new ViewManager({ factory });
    const s = mgr.open(pack(), "explorer", bridge(pack()));
    const view = views[0]!;

    mgr.setBounds(s.sessionId, { x: 0, y: 0, width: 800, height: 600 });
    mgr.setVisible(s.sessionId, false);
    expect(view.bounds).toEqual({ x: -10000, y: -10000, width: 1, height: 1 });

    const parked = view.bounds;
    mgr.setVisible(s.sessionId, true);
    expect(view.bounds).toEqual(parked); // unchanged — host re-pushes
  });

  test("double-hide is idempotent", () => {
    const { factory } = makeFactory();
    const mgr = new ViewManager({ factory });
    const s = mgr.open(pack(), "explorer", bridge(pack()));
    mgr.setVisible(s.sessionId, false);
    mgr.setVisible(s.sessionId, false);
    expect(mgr.get(s.sessionId)).not.toBeNull();
  });

  test("unknown session → NOT_FOUND", () => {
    const mgr = new ViewManager({ factory: makeFactory().factory });
    expect(() => mgr.setVisible("vs_none", false)).toThrow(/no view session/);
  });
});
