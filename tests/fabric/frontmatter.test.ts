// feature 017: frontmatter parsing + contract validation (T005)
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  parseManifest,
  parseMarkdownSpec,
  validateAgent,
  validateSkill,
} from "../../src/bun/fabric/frontmatter";
import { PackError } from "../../src/bun/fabric/errors";

const FX = join(import.meta.dir, "../extensions/fixtures");

const doc = (fm: string) => `---\n${fm}---\nbody\n`;

describe("parseManifest", () => {
  test("notes-pack parses with capabilities + commands", () => {
    const m = parseManifest("p", `name: notes-pack\nversion: 1.0.0\napiLevel: 1\ncapabilities: [storage]\n`);
    expect(m.name).toBe("notes-pack");
    expect(m.capabilities).toEqual(["storage"]);
  });

  test("apiLevel mismatch → PACK_INCOMPATIBLE", () => {
    expect(() =>
      parseManifest("p", `name: x\nversion: 1\napiLevel: 99\n`),
    ).toThrowError(PackError);
    try {
      parseManifest("p", `name: x\nversion: 1\napiLevel: 99\n`);
    } catch (e) {
      expect((e as PackError).code).toBe("PACK_INCOMPATIBLE");
      expect((e as PackError).path).toBe("apiLevel");
    }
  });

  test("non-slug name rejected with located path", () => {
    try {
      parseManifest("p", `name: "Bad Name"\nversion: 1\napiLevel: 1\n`);
      expect.unreachable();
    } catch (e) {
      expect((e as PackError).path).toBe("name");
    }
  });

  test("unknown capability rejected", () => {
    try {
      parseManifest("p", `name: x\nversion: 1\napiLevel: 1\ncapabilities: [fs.root]\n`);
      expect.unreachable();
    } catch (e) {
      expect((e as PackError).path).toBe("capabilities");
    }
  });
});

describe("validateSkill", () => {
  test("prompt skill round-trips ports/params", () => {
    const s = parseMarkdownSpec("f", doc(`name: summarize\nversion: 1.0.0\ndescription: d\nruntime: prompt\ninputs:\n  transcript: {type: text}\noutputs:\n  summary: {type: text}\nparams:\n  tone: {default: neutral}\n`), validateSkill);
    expect(s.frontmatter.runtime).toBe("prompt");
    expect(s.frontmatter.inputs?.transcript?.type).toBe("text");
  });

  test("unknown runtime rejected", () => {
    expect(() =>
      parseMarkdownSpec("f", doc(`name: x\nversion: 1\ndescription: d\nruntime: component:not.real\n`), validateSkill),
    ).toThrowError(/component:<builtin>/);
  });

  test("pipeline steps DAG: forward ref rejected", () => {
    const fm = `name: p\nversion: 1\ndescription: d\nkind: pipeline\nsteps:\n  - id: a\n    uses: s1\n    inputs: {x: "b.y"}\n  - id: b\n    uses: s2\n`;
    try {
      parseMarkdownSpec("f", doc(fm), validateSkill);
      expect.unreachable();
    } catch (e) {
      expect((e as PackError).message).toContain("topologically");
    }
  });

  test("guidance sections extracted", () => {
    const spec = parseMarkdownSpec(
      "f",
      `---\nname: s\nversion: 1\ndescription: d\n---\n# T\n\n## When to use\nwhen.\n\n## Common mistakes\noops.\n`,
      validateSkill,
    );
    expect(spec.sections["when to use"]).toBe("when.");
    expect(spec.sections["common mistakes"]).toBe("oops.");
  });
});

describe("validateAgent", () => {
  test("llm kind cannot have children", () => {
    expect(() =>
      parseMarkdownSpec("f", doc(`name: a\nkind: llm\nchildren: [b]\n`), validateAgent),
    ).toThrowError(/cannot have children/);
  });

  test("pipeline kind requires pipeline name", () => {
    expect(() =>
      parseMarkdownSpec("f", doc(`name: a\nkind: pipeline\n`), validateAgent),
    ).toThrowError(/requires a pipeline/);
  });

  test("router with children ok", () => {
    const s = parseMarkdownSpec("f", doc(`name: lead\nkind: router\nchildren: [worker]\n`), validateAgent);
    expect(s.frontmatter.children).toEqual(["worker"]);
  });
});

describe("fixture packs", () => {
  test("broken-pack fails validation", () => {
    const { readSpecFile } = require("../../src/bun/fabric/frontmatter");
    expect(() => readSpecFile(join(FX, "broken-pack/skills/bad/SKILL.md"), validateSkill)).toThrowError(PackError);
  });
});
