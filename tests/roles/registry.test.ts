// ModelRegistry contract: shared slots by path, MAX_SLOTS LRU eviction,
// busy-slot protection, stale-on-release semantics (T005/T009).
import { describe, expect, test } from "bun:test";
import { ModelRegistry, type SlotEngine } from "../../src/bun/models/registry";

function fakeEngine(failLoad = false): SlotEngine & { loaded: string | null } {
  const state = { loaded: null as string | null, disposed: false, generating: false };
  return {
    get loaded() {
      return state.loaded;
    },
    status: () => ({ status: "ready" as const, name: "fake" }),
    loadModel: async (path: string) => {
      if (failLoad) throw new Error("load failed");
      state.loaded = path;
      return { status: "ready" as const, name: path };
    },
    unloadModel: () => {
      state.loaded = null;
    },
    isGenerating: () => state.generating,
    contextSize: () => 4096,
    chatTemplate: () => null,
    tokenCount: (t: string) => t.length,
    generate: async () => ({
      status: "complete" as const,
      tokens: 1,
      elapsedMs: 1,
      warm: false,
    }),
    stop: () => {},
    dispose: () => {
      state.disposed = true;
    },
  };
}

describe("ModelRegistry", () => {
  test("two acquires on the same path share one slot (FR-011)", async () => {
    const reg = new ModelRegistry(2, () => fakeEngine());
    const a = await reg.acquire("/m/x.gguf");
    const b = await reg.acquire("/m/x.gguf");
    expect(a).toBe(b);
    expect(reg.size()).toBe(1);
  });

  test("MAX_SLOTS evicts the least-recently-used non-busy slot", async () => {
    const reg = new ModelRegistry(2, () => fakeEngine());
    const a = await reg.acquire("/m/a.gguf");
    await new Promise((r) => setTimeout(r, 5));
    const b = await reg.acquire("/m/b.gguf");
    await new Promise((r) => setTimeout(r, 5));
    const c = await reg.acquire("/m/c.gguf");
    expect(reg.size()).toBe(2);
    expect(reg.slotFor("/m/a.gguf")).toBeNull(); // LRU victim
    expect(reg.slotFor("/m/b.gguf")).toBe(b);
    expect(reg.slotFor("/m/c.gguf")).toBe(c);
  });

  test("busy slots are never evicted; all-busy throws ENGINE_BUSY", async () => {
    const reg = new ModelRegistry(2, () => fakeEngine());
    await reg.acquire("/m/a.gguf");
    await reg.acquire("/m/b.gguf");
    reg.pin("/m/a.gguf", "conv-1");
    reg.pin("/m/b.gguf", "conv-1");
    await expect(reg.acquire("/m/c.gguf")).rejects.toMatchObject({
      code: "ENGINE_BUSY",
    });
    expect(reg.size()).toBe(2);
  });

  test("release clears the pin; stale slots free on release (D9)", async () => {
    const reg = new ModelRegistry(2, () => fakeEngine());
    await reg.acquire("/m/a.gguf");
    reg.pin("/m/a.gguf", "conv-1");
    reg.markStale("/m/a.gguf");
    reg.release("/m/a.gguf");
    expect(reg.slotFor("/m/a.gguf")).toBeNull();
    expect(reg.size()).toBe(0);
  });

  test("load failure propagates and leaves no slot", async () => {
    const reg = new ModelRegistry(2, () => fakeEngine(true));
    await expect(reg.acquire("/m/bad.gguf")).rejects.toThrow("load failed");
    expect(reg.size()).toBe(0);
  });

  test("shutdown frees all slots", async () => {
    const reg = new ModelRegistry(2, () => fakeEngine());
    await reg.acquire("/m/a.gguf");
    await reg.acquire("/m/b.gguf");
    reg.shutdown();
    expect(reg.size()).toBe(0);
  });
});
