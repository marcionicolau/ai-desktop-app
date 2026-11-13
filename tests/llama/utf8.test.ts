import { describe, expect, test } from "bun:test";
import { Utf8Stream } from "../../src/bun/llama/utf8";

// token pieces are raw bytes; characters can straddle token boundaries

function run(text: string, chunkSizes: number[]): string {
  const bytes = new TextEncoder().encode(text);
  const s = new Utf8Stream();
  let out = "";
  let i = 0;
  let k = 0;
  while (i < bytes.length) {
    const n = chunkSizes[k++ % chunkSizes.length]!;
    out += s.push(bytes.subarray(i, i + n));
    i += n;
  }
  return out + s.flush();
}

describe("Utf8Stream", () => {
  test("a 2-byte character split across tokens decodes whole", () => {
    expect(run("café", [1])).toBe("café");
  });

  test("a 4-byte emoji split byte-by-byte decodes whole", () => {
    expect(run("ok 😀 done", [1])).toBe("ok 😀 done");
  });

  test("CJK and accents with irregular chunking round-trip", () => {
    const text = "MMC de 18 e 3 → mínimo múltiplo comum 最小公倍数 ✓";
    expect(run(text, [1, 2, 3, 5])).toBe(text);
    expect(run(text, [1, 2, 3, 5])).not.toContain("�");
  });

  test("push emits nothing while a character is incomplete", () => {
    const s = new Utf8Stream();
    expect(s.push(new Uint8Array([0xf0, 0x9f]))).toBe("");
    expect(s.push(new Uint8Array([0x98, 0x80]))).toBe("😀");
  });

  test("a genuinely truncated sequence flushes as U+FFFD", () => {
    const s = new Utf8Stream();
    expect(s.push(new Uint8Array([0xc3]))).toBe("");
    expect(s.flush()).toBe("�");
  });

  test("the old per-token decoder corrupts the same input (regression proof)", () => {
    const bytes = new TextEncoder().encode("é");
    const broken = [...bytes].map((b) => new TextDecoder().decode(new Uint8Array([b]))).join("");
    expect(broken).toContain("�");
  });
});
