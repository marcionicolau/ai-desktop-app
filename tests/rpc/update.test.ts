// feature 013: update.* + updates settings contract — delegates to an
// injected UpdateService; error mapping to named RPC codes.
import { describe, expect, test } from "bun:test";
import { EngineError } from "../../src/bun/llama/engine";
import {
  createRequestHandlers,
  type EngineLike,
  type HandlerDeps,
  type StoreLike,
} from "../../src/bun/rpc/handlers";
import { UpdateError } from "../../src/bun/updater/service";
import type { UpdateServiceLike } from "../../src/bun/updater/types-internal";
import type { Settings, UpdateView } from "../../src/shared/types";

const idle = (over: Partial<UpdateView> = {}): UpdateView => ({
  status: "idle",
  current: { version: "1.0.0", channel: "canary" },
  preferredChannel: "canary",
  ...over,
});

function makeService(over: Partial<UpdateServiceLike> = {}): UpdateServiceLike {
  return {
    check: async () => idle(),
    download: async () => ({}),
    apply: async () => {},
    state: () => idle(),
    preferredChannel: () => "canary",
    installedChannel: () => "canary",
    updatesEnabled: () => true,
    ...over,
  };
}

function makeDeps(updater?: UpdateServiceLike) {
  const engine: EngineLike = {
    status: () => ({ status: "unloaded" }),
    loadModel: async () => ({ status: "ready" as const, name: "f.gguf" }),
    unloadModel: () => {},
    isGenerating: () => false,
    contextSize: () => 4096,
    chatTemplate: () => null,
    generate: async () => "complete",
    stop: () => {},
  };
  let settings = {
    activeModelPath: null,
    contextLimitWarning: false,
    generation: {},
    modelOverrides: {},
    tags: [],
  } as Settings;
  const store: StoreLike = {
    getConversation: () => null,
    saveConversation: () => {},
    listConversations: () => [],
    deleteConversation: () => false,
    getSettings: () => settings,
    saveSettings: (s) => void (settings = s),
  };
  const deps: HandlerDeps = { engine, store, emit: () => {}, updater };
  return { deps, getSettings: () => settings };
}

describe("update.* contract", () => {
  test("update.state returns the service snapshot", async () => {
    const h = createRequestHandlers(makeDeps(makeService()).deps);
    const v = await h["update.state"]({});
    expect(v.status).toBe("idle");
    expect(v.current.channel).toBe("canary");
  });

  test("update.check delegates with manual flag", async () => {
    let seen: boolean | undefined;
    const svc = makeService({
      check: async (m) => {
        seen = m;
        return idle({ status: "available" });
      },
    });
    const h = createRequestHandlers(makeDeps(svc).deps);
    const v = await h["update.check"]({ manual: true });
    expect(v.status).toBe("available");
    expect(seen).toBe(true);
  });

  test("update.download returns installerPath on channelSwitch", async () => {
    const svc = makeService({
      download: async () => ({ installerPath: "/dl/ai-desktop-app-stable-linux-x64.zip" }),
    });
    const h = createRequestHandlers(makeDeps(svc).deps);
    const r = await h["update.download"]({});
    expect(r.installerPath).toContain("stable-linux-x64.zip");
  });

  test("service UpdateError maps to named RpcErrorCode", async () => {
    const svc = makeService({
      apply: async () => {
        throw new UpdateError("UPDATE_FAILED", "No staged update is ready");
      },
    });
    const h = createRequestHandlers(makeDeps(svc).deps);
    await expect(h["update.apply"]({})).rejects.toMatchObject({
      code: "UPDATE_FAILED",
    });
  });

  test("disabled service → UPDATE_DISABLED on manual check", async () => {
    const svc = makeService({
      check: async () => {
        throw new UpdateError("UPDATE_DISABLED", "Updates are disabled in settings");
      },
    });
    const h = createRequestHandlers(makeDeps(svc).deps);
    await expect(h["update.check"]({ manual: true })).rejects.toMatchObject({
      code: "UPDATE_DISABLED",
    });
  });

  test("absent updater dep → update.check rejects UPDATE_DISABLED", async () => {
    const h = createRequestHandlers(makeDeps().deps);
    await expect(h["update.check"]({ manual: true })).rejects.toMatchObject({
      code: "UPDATE_DISABLED",
    });
    const v = await h["update.state"]({});
    expect(v.status).toBe("idle");
  });
});

describe("updates settings", () => {
  test("settings.get reports defaults + service channel", async () => {
    const h = createRequestHandlers(makeDeps(makeService()).deps);
    const r = await h["settings.get"]({});
    expect(r.updates).toEqual({ enabled: true, channel: "canary" });
  });

  test("settings.set persists enabled + channel", async () => {
    const { deps, getSettings } = makeDeps(makeService());
    const h = createRequestHandlers(deps);
    await h["settings.set"]({ updates: { enabled: false, channel: "stable" } });
    expect(getSettings().updates).toEqual({ enabled: false, channel: "stable" });
    const r = await h["settings.get"]({});
    expect(r.updates.enabled).toBe(false);
    expect(r.updates.channel).toBe("stable");
  });

  test("settings.set rejects unknown channel", () => {
    const h = createRequestHandlers(makeDeps(makeService()).deps);
    expect(() =>
      h["settings.set"]({ updates: { channel: "nightly" as never } }),
    ).toThrow(EngineError);
    try {
      h["settings.set"]({ updates: { channel: "nightly" as never } });
    } catch (e) {
      expect((e as EngineError).code).toBe("INVALID_PARAMS");
    }
  });
});

// the real devkit Updater satisfies UpdaterLike structurally; tests
// inject the UpdateServiceLike stubs above
