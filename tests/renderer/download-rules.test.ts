import { describe, expect, test } from "bun:test";
import { HF_GGUF_RE as SERVER_RE } from "../../src/bun/models/download";
import {
  defaultFileName,
  HF_GGUF_RE,
  validateDownload,
} from "../../src/renderer/src/features/models/download-rules";

const GOOD = "https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF/resolve/main/SmolLM2-360M-Instruct-Q4_K_M.gguf";

describe("download rules", () => {
  test("the client regex is the server's", () => {
    expect(HF_GGUF_RE.source).toBe(SERVER_RE.source);
  });

  test("accepts a Hugging Face resolve link and derives the file name", () => {
    expect(validateDownload(GOOD, "")).toEqual({});
    expect(defaultFileName(GOOD)).toBe("SmolLM2-360M-Instruct-Q4_K_M.gguf");
  });

  test("rejects other hosts, non-gguf links and plain http", () => {
    expect(validateDownload("https://example.com/m.gguf", "").url).toContain("huggingface.co");
    expect(validateDownload("http://huggingface.co/a/b/resolve/main/m.gguf", "").url).toBeDefined();
    expect(validateDownload("https://huggingface.co/a/b/resolve/main/m.bin", "").url).toBeDefined();
  });

  test("an empty form is not an error; file names must be plain .gguf names", () => {
    expect(validateDownload("", "")).toEqual({});
    expect(validateDownload(GOOD, "m.bin").fileName).toBe("The file name must end in .gguf");
    expect(validateDownload(GOOD, "../m.gguf").fileName).toBe("Use just a file name, without folders");
    expect(validateDownload(GOOD, "m.gguf")).toEqual({});
  });
});
