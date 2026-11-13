import { describe, expect, test } from "bun:test";
import {
  ACTION_DEFS,
  actionForKey,
  buildActions,
  matchesShortcut,
  NAV_SURFACES,
  shortcutLabel,
  type ActionContext,
  type KeyLike,
} from "../../src/renderer/src/lib/actions";

const key = (k: string, o: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...o,
});

function ctx(over: Partial<ActionContext> = {}) {
  const calls: string[] = [];
  const c: ActionContext = {
    select: (id) => calls.push(`select:${id}`),
    newChat: () => calls.push("newChat"),
    toggleTheme: () => calls.push("theme"),
    resetLayout: () => calls.push("reset"),
    openPalette: (q) => calls.push(`palette:${q ?? ""}`),
    generating: false,
    ...over,
  };
  return { c, calls };
}

describe("action registry", () => {
  test("ids are unique and every surface has a navigate action", () => {
    const ids = ACTION_DEFS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of NAV_SURFACES) expect(ids).toContain(`nav:${s.id}`);
  });

  test("no two actions share a shortcut", () => {
    const seen = new Set<string>();
    for (const a of ACTION_DEFS) {
      if (!a.shortcut) continue;
      const k = shortcutLabel(a.shortcut, false);
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  test("run() delegates to the context", () => {
    const { c, calls } = ctx();
    const acts = Object.fromEntries(buildActions(c).map((a) => [a.id, a]));
    acts["chat.new"]!.run();
    acts["settings.open"]!.run();
    acts["nav:surface:models"]!.run();
    acts["theme.toggle"]!.run();
    acts["model.switch"]!.run();
    acts["layout.reset"]!.run();
    expect(calls).toEqual([
      "newChat",
      "select:surface:settings",
      "select:surface:models",
      "theme",
      "palette:Use ",
      "reset",
    ]);
  });

  test("switch model is unavailable while generating, with a reason", () => {
    const { c } = ctx({ generating: true });
    const a = buildActions(c).find((x) => x.id === "model.switch")!;
    const av = a.available();
    expect(av.ok).toBe(false);
    if (!av.ok) expect(av.reason).toContain("reply is being generated");
    expect(buildActions(ctx().c).find((x) => x.id === "model.switch")!.available().ok).toBe(true);
  });
});

describe("shortcuts", () => {
  test("labels differ by platform", () => {
    expect(shortcutLabel({ key: "k", mod: true }, false)).toBe("Ctrl+K");
    expect(shortcutLabel({ key: "k", mod: true }, true)).toBe("⌘K");
    expect(shortcutLabel({ key: "m", mod: true, shift: true }, false)).toBe("Ctrl+Shift+M");
    expect(shortcutLabel({ key: "m", mod: true, shift: true }, true)).toBe("⇧⌘M");
    expect(shortcutLabel({ key: ",", mod: true }, false)).toBe("Ctrl+,");
  });

  test("Ctrl on Linux/Windows and Cmd on macOS are the modifier", () => {
    const s = { key: "k", mod: true };
    expect(matchesShortcut(key("k", { ctrlKey: true }), s, false)).toBe(true);
    expect(matchesShortcut(key("k", { metaKey: true }), s, false)).toBe(false);
    expect(matchesShortcut(key("k", { metaKey: true }), s, true)).toBe(true);
    expect(matchesShortcut(key("k", { ctrlKey: true }), s, true)).toBe(false);
  });

  test("shift and alt must match exactly", () => {
    const s = { key: "m", mod: true, shift: true };
    expect(matchesShortcut(key("M", { ctrlKey: true, shiftKey: true }), s, false)).toBe(true);
    expect(matchesShortcut(key("m", { ctrlKey: true }), s, false)).toBe(false);
    expect(matchesShortcut(key("m", { ctrlKey: true, shiftKey: true, altKey: true }), s, false)).toBe(false);
    expect(matchesShortcut(key("k", { ctrlKey: true, shiftKey: true }), { key: "k", mod: true }, false)).toBe(false);
  });

  test("actionForKey finds the entry and skips displayOnly ones", () => {
    const acts = buildActions(ctx().c);
    expect(actionForKey(key("n", { ctrlKey: true }), acts, false)?.id).toBe("chat.new");
    expect(actionForKey(key("k", { ctrlKey: true }), acts, false)?.id).toBe("palette.open");
    // Ctrl+B belongs to the sidebar component itself
    expect(actionForKey(key("b", { ctrlKey: true }), acts, false)).toBeNull();
    expect(actionForKey(key("x", { ctrlKey: true }), acts, false)).toBeNull();
  });
});
