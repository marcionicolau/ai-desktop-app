// models/library scan: .gguf files list with meta, .part files excluded.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { scanModels } from "../../src/bun/models/library";
import { mkdtempSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const MODEL = "models/SmolLM2-135M-Instruct-Q4_K_M.gguf";

describe("scanModels", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "models-test-"));
    process.env.MODELS_DIR = dir;
  });
  afterEach(() => {
    delete process.env.MODELS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  test("lists gguf files with parsed metadata", () => {
    copyFileSync(MODEL, join(dir, "smollm2.gguf"));
    const models = scanModels();
    expect(models).toHaveLength(1);
    const m = models[0];
    expect(m.fileName).toBe("smollm2.gguf");
    expect(m.architecture).toBe("llama");
    expect(m.sizeBytes).toBeGreaterThan(0);
  });

  test("excludes .part download artifacts", () => {
    copyFileSync(MODEL, join(dir, "real.gguf"));
    writeFileSync(join(dir, "download.gguf.part"), "partial");
    const models = scanModels();
    expect(models).toHaveLength(1);
    expect(models[0].fileName).toBe("real.gguf");
  });

  test("corrupt gguf still lists with null fields", () => {
    writeFileSync(join(dir, "broken.gguf"), "garbage");
    const models = scanModels();
    expect(models).toHaveLength(1);
    expect(models[0].architecture).toBeNull();
    expect(models[0].quantization).toBeNull();
  });

  test("empty dir returns empty list", () => {
    expect(scanModels()).toEqual([]);
  });
});
