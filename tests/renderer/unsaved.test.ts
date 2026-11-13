import { describe, expect, test } from "bun:test";
import { createUnsavedStore } from "../../src/renderer/src/lib/unsaved";

describe("unsaved store", () => {
  test("tracks which forms are dirty and clears them", () => {
    const s = createUnsavedStore();
    expect(s.any()).toBe(false);
    s.set("override:a.gguf", "Generation overrides for a.gguf");
    s.set("persona:Coach", "Persona Coach");
    expect(s.any()).toBe(true);
    expect(s.labels()).toEqual(["Generation overrides for a.gguf", "Persona Coach"]);
    s.set("override:a.gguf", null);
    expect(s.labels()).toEqual(["Persona Coach"]);
    s.set("persona:Coach", null);
    expect(s.any()).toBe(false);
  });

  test("notifies subscribers only on real changes", () => {
    const s = createUnsavedStore();
    let n = 0;
    const off = s.subscribe(() => n++);
    s.set("x", "X");
    s.set("x", "X"); // same label: no change
    s.set("x", "Y"); // relabel: change
    s.set("x", null);
    s.set("x", null); // already clean: no change
    expect(n).toBe(3);
    off();
    s.set("y", "Y");
    expect(n).toBe(3);
  });
});
