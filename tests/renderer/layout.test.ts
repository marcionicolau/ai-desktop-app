import { describe, expect, test } from "bun:test";
import {
  clampSize,
  LAYOUT_PREFIX,
  readLayout,
  readSize,
  resetLayout,
  SIDEBAR_WIDTH,
  writeLayout,
  writeSize,
  type StorageLike,
} from "../../src/renderer/src/lib/layout";

function memory(): StorageLike & { map: Map<string, string>; length: number; key(i: number): string | null } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
  };
}

describe("layout sizes", () => {
  test("clamp keeps a size inside the spec's min and max", () => {
    expect(clampSize(10, SIDEBAR_WIDTH)).toBe(SIDEBAR_WIDTH.min);
    expect(clampSize(9999, SIDEBAR_WIDTH)).toBe(SIDEBAR_WIDTH.max);
    expect(clampSize(300.4, SIDEBAR_WIDTH)).toBe(300);
  });

  test("a written size is read back, clamped on the way in and out", () => {
    const st = memory();
    writeSize(SIDEBAR_WIDTH, 320, st);
    expect(readSize(SIDEBAR_WIDTH, st)).toBe(320);
    writeSize(SIDEBAR_WIDTH, 5000, st);
    expect(readSize(SIDEBAR_WIDTH, st)).toBe(SIDEBAR_WIDTH.max);
    // a tampered value outside the limits is clamped when read
    st.map.set(LAYOUT_PREFIX + SIDEBAR_WIDTH.key, "1");
    expect(readSize(SIDEBAR_WIDTH, st)).toBe(SIDEBAR_WIDTH.min);
  });

  test("missing, garbage or blocked storage falls back to the default", () => {
    expect(readSize(SIDEBAR_WIDTH, memory())).toBe(SIDEBAR_WIDTH.default);
    const st = memory();
    st.map.set(LAYOUT_PREFIX + SIDEBAR_WIDTH.key, "not a number");
    expect(readSize(SIDEBAR_WIDTH, st)).toBe(SIDEBAR_WIDTH.default);
    expect(readSize(SIDEBAR_WIDTH, null)).toBe(SIDEBAR_WIDTH.default);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    } as StorageLike;
    expect(readSize(SIDEBAR_WIDTH, throwing)).toBe(SIDEBAR_WIDTH.default);
    expect(() => writeSize(SIDEBAR_WIDTH, 300, throwing)).not.toThrow();
  });
});

describe("panel group layouts", () => {
  test("round-trips a layout that adds up to 100", () => {
    const st = memory();
    writeLayout("chat", { chat: 70, metrics: 30 }, st);
    expect(readLayout("chat", ["chat", "metrics"], st)).toEqual({ chat: 70, metrics: 30 });
  });

  test("rejects layouts that are malformed, incomplete or do not add up", () => {
    const st = memory();
    st.map.set(LAYOUT_PREFIX + "chat", "{not json");
    expect(readLayout("chat", ["chat", "metrics"], st)).toBeUndefined();
    writeLayout("chat", { chat: 70 }, st);
    expect(readLayout("chat", ["chat", "metrics"], st)).toBeUndefined(); // missing panel
    writeLayout("chat", { chat: 70, metrics: 70 }, st);
    expect(readLayout("chat", ["chat", "metrics"], st)).toBeUndefined(); // sums to 140
    writeLayout("chat", { chat: -5, metrics: 105 }, st);
    expect(readLayout("chat", ["chat", "metrics"], st)).toBeUndefined(); // out of range
  });

  test("reset removes every remembered size and leaves unrelated keys", () => {
    const st = memory();
    writeSize(SIDEBAR_WIDTH, 300, st);
    writeLayout("chat", { chat: 60, metrics: 40 }, st);
    st.setItem("unrelated", "keep");
    resetLayout(st);
    expect(readSize(SIDEBAR_WIDTH, st)).toBe(SIDEBAR_WIDTH.default);
    expect(readLayout("chat", ["chat", "metrics"], st)).toBeUndefined();
    expect(st.getItem("unrelated")).toBe("keep");
  });
});
