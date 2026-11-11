// FFI lifecycle integration test (contracts/ffi.md):
// load -> generate_begin -> lls_step N -> generate_end -> ctx_free ->
// model_free -> close -> reload succeeds.
// Requires a real GGUF: MODEL_PATH env or ./models/SmolLM2-135M-Instruct-Q4_K_M.gguf
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { EngineError, LlamaEngine } from "../../src/bun/llama/engine";

const MODEL =
  process.env.MODEL_PATH ??
  resolve(import.meta.dir, "../../models/SmolLM2-135M-Instruct-Q4_K_M.gguf");
const hasModel = existsSync(MODEL);
const suite = hasModel ? describe : describe.skip;

suite("ffi lifecycle", () => {
  const engine = new LlamaEngine();

  test("loadModel returns ready with model name", async () => {
    const res = await engine.loadModel(MODEL);
    expect(res.status).toBe("ready");
    expect(res.name).toContain(".gguf");
    expect(engine.status().status).toBe("ready");
  }, 120_000);

  test("generate emits tokens; stop resolves partial", async () => {
    const tokens: string[] = [];
    const result = await engine.generate("Hello", (d) => {
      tokens.push(d);
      if (tokens.length >= 5) engine.stop();
    });
    expect(tokens.length).toBeGreaterThanOrEqual(1);
    expect(result.status).toBe("partial");
  }, 120_000);

  test("unload then reload succeeds (ownership round-trip)", async () => {
    engine.unloadModel();
    expect(engine.status().status).toBe("unloaded");
    const res = await engine.loadModel(MODEL);
    expect(res.status).toBe("ready");
  }, 120_000);

  test("dispose closes the library; fresh load works", async () => {
    engine.dispose();
    const res = await engine.loadModel(MODEL);
    expect(res.status).toBe("ready");
    engine.dispose();
  }, 120_000);
});

describe("ffi error paths", () => {
  test("MODEL_NOT_FOUND on missing file", async () => {
    const e = new LlamaEngine();
    try {
      await e.loadModel("/nonexistent/model.gguf");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EngineError);
      expect((err as EngineError).code).toBe("MODEL_NOT_FOUND");
    }
  });

  test("generate without model rejects NO_MODEL", async () => {
    const e = new LlamaEngine();
    try {
      await e.generate("x", () => {});
      expect.unreachable();
    } catch (err) {
      expect((err as EngineError).code).toBe("NO_MODEL");
    }
  });
});
