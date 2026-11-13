import { describe, expect, test } from "bun:test";
import {
  pickActive,
  SETTINGS_GROUPS,
  SETTINGS_ORDER,
} from "../../src/renderer/src/features/settings/settings-nav";

describe("settings navigation", () => {
  test("every section appears once, in page order, under a group", () => {
    expect(new Set(SETTINGS_ORDER).size).toBe(SETTINGS_ORDER.length);
    expect(SETTINGS_GROUPS.length).toBeGreaterThan(1);
    for (const g of SETTINGS_GROUPS) expect(g.items.length).toBeGreaterThan(0);
  });

  test("the current section is the first visible one in page order", () => {
    const order = ["a", "b", "c"];
    expect(pickActive(order, new Set(["b", "c"]), null)).toBe("b");
    expect(pickActive(order, new Set(["c"]), "a")).toBe("c");
  });

  test("with nothing visible it keeps the previous one, else the first", () => {
    const order = ["a", "b", "c"];
    expect(pickActive(order, new Set(), "b")).toBe("b");
    expect(pickActive(order, new Set(), null)).toBe("a");
    expect(pickActive(order, new Set(), "gone")).toBe("a");
    expect(pickActive([], new Set(), null)).toBeNull();
  });
});
