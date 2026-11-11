// lls_gguf_meta contract (contracts/ffi.md): header-only parse returns JSON
// metadata for a real GGUF; clear errors for non-GGUF/missing files.
import { describe, expect, test } from "bun:test";
import { readGgufMeta } from "../../src/bun/models/library";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const MODEL = "models/SmolLM2-135M-Instruct-Q4_K_M.gguf";

describe("lls_gguf_meta", () => {
  test("parses SmolLM2 header metadata", () => {
    const meta = readGgufMeta(MODEL);
    // SmolLM2 registers under the llama architecture namespace
    expect(meta.architecture).toBe("llama");
    expect(meta.name).toContain("SmolLM2");
    expect(meta.quantization).toBe("Q4_K_M");
    expect(meta.contextTrain).toBeGreaterThan(0);
    // paramCount is optional in GGUF — accept null or a formatted string
    if (meta.paramCount !== null) {
      expect(meta.paramCount).toMatch(/^\d+(\.\d+)?[BM]?$/);
    }
  });

  test("rejects non-GGUF file", () => {
    const tmp = join("/tmp", "not-a-gguf.bin");
    writeFileSync(tmp, "this is definitely not a gguf file");
    try {
      expect(() => readGgufMeta(tmp)).toThrow("not a GGUF file");
    } finally {
      unlinkSync(tmp);
    }
  });

  test("rejects missing file", () => {
    expect(() => readGgufMeta("/tmp/does-not-exist.gguf")).toThrow(
      "cannot open file",
    );
  });
});
