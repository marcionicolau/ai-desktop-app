// feature 019 (T008/T013/T014): workspace tab model — deriveTabs +
// reconcile transitions per data-model.md.
import { describe, expect, test } from "bun:test";
import {
  CHAT_TAB,
  deriveTabs,
  reconcile,
} from "../src/renderer/src/features/workspace/tab-model";
import type { InstalledPackView } from "../src/shared/types";
import type { PackManifest } from "../src/shared/pack-schema";

const manifest = (name: string, views: PackManifest["contributions"]["views"] = []): PackManifest => ({
  name,
  version: "1.0.0",
  apiLevel: 1,
  capabilities: [],
  contributions: { views },
});

const pack = (
  id: string,
  state: InstalledPackView["state"],
  views: PackManifest["contributions"]["views"] = [],
): InstalledPackView => ({
  id,
  dir: `/packs/${id}`,
  state,
  source: { kind: "folder", ref: `/packs/${id}` },
  manifest: manifest(id, views),
  installedAt: 0,
});

const explorer = { id: "explorer", title: "Explorer", slot: "tab" as const, entry: "v/index.html" };
const panel = { id: "stats", title: "Stats", slot: "panel" as const, entry: "v/stats.html" };

describe("deriveTabs", () => {
  test("chat is always first; no packs → chat only", () => {
    expect(deriveTabs([])).toEqual([CHAT_TAB]);
    expect(deriveTabs([pack("a", "installed")])).toEqual([CHAT_TAB]);
  });

  test("enabled pack's tab views → ext tabs; panel/disabled excluded", () => {
    const tabs = deriveTabs([
      pack("a", "enabled", [explorer, panel]),
      pack("b", "disabled", [explorer]),
      pack("c", "enabled", [explorer]),
    ]);
    expect(tabs.map((t) => t.id)).toEqual(["chat", "a:explorer", "c:explorer"]);
    const ext = tabs[1]!;
    expect(ext).toMatchObject({ kind: "ext", title: "Explorer", packName: "a" });
  });

  test("enabled pack without tab views → pack tab (workspace browser)", () => {
    const tabs = deriveTabs([
      pack("a", "enabled"), // no views at all
      pack("b", "enabled", [panel]), // panel-only
    ]);
    expect(tabs.map((t) => t.id)).toEqual(["chat", "a", "b"]);
    expect(tabs[1]).toMatchObject({ kind: "pack", packId: "a" });
    expect(tabs[2]).toMatchObject({ kind: "pack", packId: "b" });
  });

  test("multiple tab views per pack → multiple tabs in declaration order", () => {
    const second = { ...explorer, id: "logs", title: "Logs" };
    const tabs = deriveTabs([pack("a", "enabled", [explorer, second])]);
    expect(tabs.map((t) => t.id)).toEqual(["chat", "a:explorer", "a:logs"]);
  });

  test("title fallback: empty title → viewId", () => {
    const v = { ...explorer, title: "" };
    const t = deriveTabs([pack("a", "enabled", [v])])[1]!;
    expect(t.kind === "ext" && t.title).toBe("explorer");
  });
});

describe("reconcile", () => {
  const base = deriveTabs([pack("a", "enabled", [explorer]), pack("b", "enabled")]);

  test("newly enabled tab auto-selects (FR-005)", () => {
    const prev = { tabs: [CHAT_TAB] as never[], selectedId: "chat" };
    const next = reconcile(prev, [pack("a", "enabled", [explorer])]);
    expect(next.selectedId).toBe("a:explorer");
  });

  test("selected tab survives unrelated changes", () => {
    const prev = { tabs: base, selectedId: "a:explorer" };
    const next = reconcile(prev, [
      pack("a", "enabled", [explorer]),
      pack("b", "installed"),
    ]);
    expect(next.selectedId).toBe("a:explorer");
  });

  test("selected tab vanished → fallback to chat (FR-010)", () => {
    const prev = { tabs: base, selectedId: "a:explorer" };
    const next = reconcile(prev, [pack("a", "disabled", [explorer])]);
    expect(next.tabs).toEqual([CHAT_TAB]);
    expect(next.selectedId).toBe("chat");
  });

  test("pack removal also drops its tabs", () => {
    const prev = { tabs: base, selectedId: "a:explorer" };
    const next = reconcile(prev, []);
    expect(next.selectedId).toBe("chat");
  });

  test("startup restore: baseline derive never selects ext (FR-006)", () => {
    // initial state is built by the hook via deriveTabs + "chat" — reconcile
    // against itself treats restored tabs as known, not fresh
    const prev = { tabs: base, selectedId: "chat" };
    const next = reconcile(prev, [pack("a", "enabled", [explorer])]);
    expect(next.selectedId).toBe("chat");
  });
});
