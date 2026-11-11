// Engine error-path test (US3): lls_model_load failure surfaces typed errors;
// char** err is freed via lls_free_string (no leak on the error path).
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EngineError, LlamaEngine } from "../../src/bun/llama/engine";

const dir = mkdtempSync(join(tmpdir(), "ffi-errors-"));
const corrupt = join(dir, "corrupt.gguf");
writeFileSync(corrupt, "this is definitely not a GGUF file");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("engine error paths", () => {
  test("corrupt file -> MODEL_INVALID with human-readable message", async () => {
    const engine = new LlamaEngine();
    try {
      await engine.loadModel(corrupt);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EngineError);
      expect((e as EngineError).code).toBe("MODEL_INVALID");
      expect((e as EngineError).message.length).toBeGreaterThan(0);
    }
    // engine stays unloaded and usable after the failure
    expect(engine.status().status).toBe("unloaded");
    engine.dispose();
  }, 60_000);

  test("failed load does not poison the engine (subsequent load works)", async () => {
    const { existsSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const model =
      process.env.MODEL_PATH ??
      resolve(import.meta.dir, "../../models/SmolLM2-135M-Instruct-Q4_K_M.gguf");
    if (!existsSync(model)) return; // skip when no model fixture

    const engine = new LlamaEngine();
    try {
      await engine.loadModel(corrupt);
    } catch {
      // expected
    }
    const res = await engine.loadModel(model);
    expect(res.status).toBe("ready");
    engine.dispose();
  }, 120_000);
});
