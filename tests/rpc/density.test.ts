// feature 026 (FR-016): settings.density — default, persistence, validation.
import { describe, expect, test } from "bun:test";
import { createRequestHandlers, type StoreLike } from "../../src/bun/rpc/handlers";
import type { Settings } from "../../src/shared/types";
import { DEFAULT_GENERATION } from "../../src/shared/types";

function setup(initial: Partial<Settings> = {}) {
  const settings: Settings = {
    activeModelPath: null,
    contextLimitWarning: false,
    generation: DEFAULT_GENERATION,
    modelOverrides: {},
    tags: [],
    ...initial,
  };
  let saves = 0;
  const store: StoreLike = {
    getConversation: () => null,
    saveConversation: () => {},
    listConversations: () => [],
    deleteConversation: () => false,
    getSettings: () => settings,
    saveSettings: (n) => {
      saves++;
      Object.assign(settings, n);
    },
  };
  const deps = { store, emit: () => {} } as never;
  const call = (m: string, p: Record<string, unknown> = {}) =>
    (createRequestHandlers(deps) as never)[m](p);
  return { call, settings, saves: () => saves };
}

describe("settings.density", () => {
  test("absent density reads as comfortable", async () => {
    const { call } = setup();
    expect((await call("settings.get")).density).toBe("comfortable");
  });

  test("a valid density is persisted and read back", async () => {
    const { call, settings } = setup();
    await call("settings.set", { density: "compact" });
    expect(settings.density).toBe("compact");
    expect((await call("settings.get")).density).toBe("compact");
    await call("settings.set", { density: "comfortable" });
    expect((await call("settings.get")).density).toBe("comfortable");
  });

  test("an unknown density is rejected and nothing is written", async () => {
    const { call, settings, saves } = setup({ density: "compact" });
    let code = "";
    try {
      await call("settings.set", { density: "tiny" });
    } catch (e) {
      code = (e as { code?: string }).code ?? String(e);
    }
    expect(code).toContain("INVALID_PARAMS");
    expect(settings.density).toBe("compact");
    expect(saves()).toBe(0);
  });

  test("setting another field leaves density untouched", async () => {
    const { call, settings } = setup({ density: "compact" });
    await call("settings.set", { outputPanel: true });
    expect(settings.density).toBe("compact");
  });
});
