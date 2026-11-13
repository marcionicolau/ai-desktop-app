import { describe, expect, test } from "bun:test";
import {
  MAX_PROMPT_BYTES,
  validateName,
  validatePersonaDraft,
  validateSnippet,
} from "../../src/renderer/src/features/personas/persona-rules";

const ok = { name: "code-review", systemPrompt: "Be terse.", temperature: "", topP: "", maxTokens: "" };

describe("persona rules", () => {
  test("a valid draft has no errors, empty params inherit", () => {
    expect(validatePersonaDraft(ok)).toEqual({});
  });

  test("names must be lowercase slugs of at most 32 characters", () => {
    expect(validateName("")).toBe("Name is required");
    expect(validateName("Code Review")).toContain("lowercase letters");
    expect(validateName("double--dash")).toContain("lowercase letters");
    expect(validateName("-lead")).toContain("lowercase letters");
    expect(validateName("a".repeat(33))).toContain("at most 32");
    expect(validateName("ok-name-2")).toBeNull();
  });

  test("the prompt is required and byte-limited (multi-byte characters count)", () => {
    expect(validatePersonaDraft({ ...ok, systemPrompt: "  " }).systemPrompt).toBe("The system prompt is required");
    const big = "é".repeat(MAX_PROMPT_BYTES / 2 + 1); // 2 bytes each
    expect(validatePersonaDraft({ ...ok, systemPrompt: big }).systemPrompt).toContain("limit is 8192");
  });

  test("parameter fields reuse the generation ranges", () => {
    const e = validatePersonaDraft({ ...ok, temperature: "3", topP: "-1", maxTokens: "1.5" });
    expect(e.temperature).toBe("Must be between 0 and 2");
    expect(e.topP).toBe("Must be between 0 and 1");
    expect(e.maxTokens).toBe("Must be a whole number");
  });

  test("snippets need a slug name and bounded text", () => {
    expect(validateSnippet("Bad Name", "x").name).toContain("lowercase");
    expect(validateSnippet("fix", "").text).toBe("The text is required");
    expect(validateSnippet("fix", "text")).toEqual({});
  });
});
