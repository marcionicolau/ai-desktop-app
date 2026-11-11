// FFI generation params (contracts/ffi.md): fixed-seed reproducibility,
// maxTokens bound, NULL params = greedy defaults.
// Requires a real GGUF: MODEL_PATH env or ./models/SmolLM2-135M-Instruct-Q4_K_M.gguf
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_GENERATION } from "../../src/shared/types";
import { LlamaEngine } from "../../src/bun/llama/engine";

const MODEL =
  process.env.MODEL_PATH ??
  resolve(import.meta.dir, "../../models/SmolLM2-135M-Instruct-Q4_K_M.gguf");
const suite = existsSync(MODEL) ? describe : describe.skip;

suite("ffi generation params", () => {
  const engine = new LlamaEngine();

  const gen = async (params: typeof DEFAULT_GENERATION | null) => {
    let out = "";
    const res = await engine.generate("Say hi", (d) => (out += d), params);
    return { out, ...res };
  };

  test("loadModel", async () => {
    const res = await engine.loadModel(MODEL);
    expect(res.status).toBe("ready");
  }, 120_000);

  test("fixed seed + sampling is reproducible and maxTokens-bound", async () => {
    const params = {
      ...DEFAULT_GENERATION,
      temperature: 1.0,
      topP: 0.9,
      seed: 42,
      maxTokens: 24,
    };
    const a = await gen(params);
    const b = await gen(params);
    expect(a.out).toBe(b.out);
    expect(a.status).toBe("complete");
    expect(a.tokens).toBeLessThanOrEqual(24);
    expect(a.tokens).toBeGreaterThan(0);
    expect(b.tokens).toBeLessThanOrEqual(24);
  }, 120_000);

  test("maxTokens=8 yields a short reply", async () => {
    const r = await gen({ ...DEFAULT_GENERATION, maxTokens: 8 });
    expect(r.status).toBe("complete");
    expect(r.tokens).toBeLessThanOrEqual(8);
  }, 120_000);

  test("null params keep greedy defaults", async () => {
    const r = await gen(null);
    expect(r.status).toBe("complete");
    expect(r.tokens).toBeGreaterThan(0);
  }, 120_000);
});
