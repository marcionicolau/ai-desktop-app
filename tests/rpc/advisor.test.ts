// RPC tests for feature 011: bounded benchmark (BUSY gate, persistence,
// partial flag, absolute paths) + live advise verdicts (estimated vs
// measured basis, fusion combine).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  EngineLike,
  HandlerDeps,
  StoreLike,
} from "../../src/bun/rpc/handlers";
import { RolesService } from "../../src/bun/models/roles";
import type { Conversation, Settings } from "../../src/shared/types";
import { DEFAULT_GENERATION } from "../../src/shared/types";

let dataDir: string;
let modelsDir: string;
let createRequestHandlers: typeof import("../../src/bun/rpc/handlers").createRequestHandlers;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "adv-rpc-"));
  modelsDir = mkdtempSync(join(tmpdir(), "adv-models-"));
  process.env.APP_DATA_DIR = dataDir;
  process.env.MODELS_DIR = modelsDir;
  ({ createRequestHandlers } = await import("../../src/bun/rpc/handlers"));
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(modelsDir, { recursive: true, force: true });
  delete process.env.APP_DATA_DIR;
  delete process.env.MODELS_DIR;
});

const mkModel = (name: string, bytes: number) => {
  const p = join(modelsDir, name);
  writeFileSync(p, Buffer.alloc(bytes, 1));
  return p;
};

function makeDeps(opts: {
  generating?: boolean;
  genStatus?: "complete" | "partial";
  holdGenerate?: { release: Promise<void> };
  settings?: Partial<Settings>;
} = {}) {
  const emitted: { method: string; payload: unknown }[] = [];
  const convs = new Map<string, Conversation>();
  let generating = opts.generating ?? false;
  const settings: Settings = {
    activeModelPath: null,
    contextLimitWarning: false,
    generation: DEFAULT_GENERATION,
    tags: [],
    ...opts.settings,
  } as Settings;

  const engine: EngineLike = {
    status: () => ({ status: "ready", name: "fake.gguf" }),
    loadModel: async () => ({ status: "ready", name: "fake.gguf" }),
    unloadModel: () => {},
    isGenerating: () => generating,
    contextSize: () => 2048,
    chatTemplate: () => null,
    tokenCount: (t: string) => Math.ceil(t.length / 4),
    stop: () => {},
    generate: async (_p, _t) => {
      if (opts.holdGenerate) await opts.holdGenerate.release;
      return {
        status: opts.genStatus ?? "complete",
        tokens: 10,
        elapsedMs: 1000,
        warm: false,
      };
    },
  };

  const store: StoreLike = {
    getConversation: (id) => convs.get(id) ?? null,
    saveConversation: (c) => void convs.set(c.id, c),
    listConversations: () => [],
    deleteConversation: () => false,
    getSettings: () => settings,
    saveSettings: () => {},
  };

  return { engine, store, emitted, settings };
}

const call = async (
  deps: HandlerDeps,
  method: string,
  params: Record<string, unknown>,
) =>
  (createRequestHandlers(deps) as Record<string, Function>)[method](params);

const deps = (d: ReturnType<typeof makeDeps>, roles?: RolesService) =>
  ({
    engine: d.engine,
    store: d.store,
    emit: (m: string, p: unknown) => d.emitted.push({ method: m, payload: p }),
    ...(roles ? { roles } : {}),
  }) as HandlerDeps;

describe("model.benchmark", () => {
  test("benchmark persists a measured record keyed by fingerprint", async () => {
    const path = mkModel("m1.gguf", 4096);
    const d = makeDeps();
    const r = await call(deps(d), "model.benchmark", { path });
    expect(r.record.fingerprint).toBe("m1.gguf:4096");
    expect(r.record.tokensPerSec).toBe(10); // 10 tok / 1 s
    expect(r.record.peakBytes).toBeGreaterThanOrEqual(4096); // floored at size
    expect(r.record.partial).toBeUndefined();
    const onDisk = JSON.parse(
      readFileSync(join(dataDir, "benchmarks.json"), "utf8"),
    );
    expect(onDisk["m1.gguf:4096"].tokensPerSec).toBe(10);
  });

  test("absolute path outside the library benchmarks identically", async () => {
    const ext = join(tmpdir(), `adv-ext-${Date.now()}.gguf`);
    writeFileSync(ext, Buffer.alloc(1024, 1));
    const r = await call(deps(makeDeps()), "model.benchmark", { path: ext });
    expect(r.record.fingerprint).toMatch(/adv-ext-.*\.gguf:1024/);
    rmSync(ext);
  });

  test("missing path -> MODEL_NOT_FOUND", async () => {
    await expect(
      call(deps(makeDeps()), "model.benchmark", { path: "/no/such.gguf" }),
    ).rejects.toMatchObject({ code: "MODEL_NOT_FOUND" });
  });

  test("benchmark while generating -> ENGINE_BUSY", async () => {
    await expect(
      call(deps(makeDeps({ generating: true })), "model.benchmark", {
        path: mkModel("busy.gguf", 128),
      }),
    ).rejects.toMatchObject({ code: "ENGINE_BUSY" });
  });

  test("concurrent benchmark -> ENGINE_BUSY", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const d = makeDeps({ holdGenerate: { release: gate } });
    const path = mkModel("conc.gguf", 128);
    const first = call(deps(d), "model.benchmark", { path });
    await new Promise((r) => setTimeout(r, 10)); // let it enter generate
    await expect(
      call(deps(d), "model.benchmark", { path }),
    ).rejects.toMatchObject({ code: "ENGINE_BUSY" });
    release();
    await first;
  });

  test("partial run records partial: true", async () => {
    const path = mkModel("part.gguf", 128);
    const r = await call(
      deps(makeDeps({ genStatus: "partial" })),
      "model.benchmark",
      { path },
    );
    expect(r.record.partial).toBe(true);
  });
});

describe("model.advise", () => {
  test("pre-benchmark rows report estimated basis + live verdicts", async () => {
    mkModel("fresh.gguf", 4096);
    const r = await call(deps(makeDeps()), "model.advise", {});
    const row = r.models.find((m: { fileName: string }) => m.fileName === "fresh.gguf");
    expect(row.basis).toBe("estimated");
    expect(row.benchmark).toBeUndefined();
    expect(row.verdict).toBe("fits"); // tiny file always fits
    expect(row.recommendedCtx).toBeGreaterThan(0);
    expect(row.basisBytes).toBeGreaterThan(4096);
  });

  test("post-benchmark rows report measured basis + persisted figure", async () => {
    const path = mkModel("meas.gguf", 2048);
    const d = makeDeps();
    await call(deps(d), "model.benchmark", { path });
    const r = await call(deps(d), "model.advise", {});
    const row = r.models.find((m: { fileName: string }) => m.fileName === "meas.gguf");
    expect(row.basis).toBe("measured");
    expect(row.benchmark.tokensPerSec).toBe(10);
  });

  test("fusion combine reports sequential peak + combined residency", async () => {
    mkModel("plan.gguf", 4096);
    mkModel("exec.gguf", 8192);
    const d = makeDeps({
      settings: {
        tags: [
          { name: "plan", binding: "plan.gguf", fallback: [], params: null },
          { name: "exec", binding: "exec.gguf", fallback: [], params: null },
        ] as never,
      },
    });
    const roles = new RolesService({ store: d.store });
    const r = await call(
      deps(d, roles),
      "model.advise",
      { plannerTag: "plan", executorTag: "exec" },
    );
    expect(r.fusion.sequentialPeakBytes).toBeGreaterThanOrEqual(8192);
    expect(r.fusion.combinedBytes).toBeGreaterThan(r.fusion.sequentialPeakBytes);
    expect(["fits", "tight", "wontfit"]).toContain(r.fusion.verdict);
  });
});
