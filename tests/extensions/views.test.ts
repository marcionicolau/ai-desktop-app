// feature 017 (T041): ViewManager — open/close/setBounds over a fake
// BrowserView factory; per-pack partition + locked viewsRoot; reopen
// replaces the session (reload path); closeFor on pack disable.
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

const pack = (id = "views-pack"): InstalledPackView => ({
  id,
  dir: `/packs/${id}`,
  state: "enabled",
  source: { kind: "folder", ref: `/packs/${id}` },
  manifest: { ...manifest, name: id },
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
  const created: { opts: ViewFactoryOpts; view: BrowserViewLike }[] = [];
  const factory = (opts: ViewFactoryOpts): BrowserViewLike => {
    const view: BrowserViewLike = {
      id: created.length + 1,
      bounds: undefined as never,
      closed: false as never,
      setBounds(frame: { x: number; y: number; width: number; height: number }) {
        (view as unknown as { bounds: unknown }).bounds = frame;
      },
      remove() {
        (view as unknown as { closed: boolean }).closed = true;
      },
    };
    created.push({ opts, view });
    return view;
  };
  return { created, factory };
}

describe("ViewManager", () => {
  test("open builds a view with per-pack partition + pack viewsRoot", () => {
    const { created, factory } = makeFactory();
    const vm = new ViewManager({ factory });
    const s = vm.open(pack(), "explorer", bridge(pack()));
    expect(s.sessionId).toMatch(/^vs_/);
    expect(created[0].opts.partition).toBe("persist:ext-views-pack");
    expect(created[0].opts.viewsRoot).toBe("/packs/views-pack");
    expect(created[0].opts.entry).toBe("/packs/views-pack/views/explorer/index.html");
  });

  test("unknown view id → CONTRIBUTION_NOT_FOUND; no factory → error", () => {
    const vm = new ViewManager({ factory: makeFactory().factory });
    expect(() => vm.open(pack(), "nope", bridge(pack()))).toThrowError(/no view/);
    const headless = new ViewManager({});
    expect(() => headless.open(pack(), "explorer", bridge(pack()))).toThrowError(/no BrowserView factory/);
  });

  test("reopen replaces the session (reload path)", () => {
    const { created, factory } = makeFactory();
    const vm = new ViewManager({ factory });
    const p = pack();
    const s1 = vm.open(p, "explorer", bridge(p));
    const s2 = vm.open(p, "explorer", bridge(p));
    expect(s2.sessionId).not.toBe(s1.sessionId);
    expect((created[0].view as unknown as { closed: boolean }).closed).toBe(true);
    expect(created).toHaveLength(2);
  });

  test("setBounds forwards to the view; unknown session → NOT_FOUND", () => {
    const { created, factory } = makeFactory();
    const vm = new ViewManager({ factory });
    const p = pack();
    const s = vm.open(p, "explorer", bridge(p));
    vm.setBounds(s.sessionId, { x: 1, y: 2, width: 300, height: 200 });
    expect(created[0].view).toMatchObject({ bounds: { x: 1, y: 2, width: 300, height: 200 } });
    expect(() => vm.setBounds("vs_999", { x: 0, y: 0, width: 1, height: 1 })).toThrowError(/no view session/);
  });

  test("closeFor destroys only that pack's sessions", () => {
    const { created, factory } = makeFactory();
    const vm = new ViewManager({ factory });
    const a = pack("views-pack");
    const b = pack("views-pack-b");
    vm.open(a, "explorer", bridge(a));
    vm.open(b, "explorer", bridge(b));
    vm.closeFor("views-pack");
    expect((created[0].view as unknown as { closed: boolean }).closed).toBe(true);
    expect((created[1].view as unknown as { closed: boolean }).closed).not.toBe(true);
  });
});
