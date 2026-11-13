// feature 023 (T042): runtime:"script" skills — frontmatter acceptance,
// scripts.run capability gate, step dispatch through ctx.runScript,
// output folding, missing-script located failures.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSkill } from "../../src/bun/fabric/frontmatter";
import { parseMarkdownSpec } from "../../src/bun/fabric/frontmatter";
import { ContributionRegistry } from "../../src/bun/fabric/registry";
import { executePipeline } from "../../src/bun/fabric/pipeline";
import { PackError, FabricError } from "../../src/bun/fabric/errors";
import type { RunCtx } from "../../src/bun/fabric/components";
import type { SkillContrib } from "../../src/bun/fabric/registry";
import type { SkillView } from "../../src/shared/types";
import type { PackManifest } from "../../src/shared/pack-schema";

const doc = (fm: string) => `---\n${fm}\n---\n## Instructions\nx\n`;

describe("validateSkill: runtime script", () => {
  test("accepts runtime: script + script slug", () => {
    const s = parseMarkdownSpec(
      "f",
      doc("name: score\nversion: 1.0.0\ndescription: d\nruntime: script\nscript: my-script\n"),
      validateSkill,
    );
    expect(s.frontmatter.runtime).toBe("script");
    expect(s.frontmatter.script).toBe("my-script");
  });

  test("runtime: script without script field → error", () => {
    expect(() =>
      parseMarkdownSpec(
        "f",
        doc("name: x\nversion: 1.0.0\ndescription: d\nruntime: script\n"),
        validateSkill,
      ),
    ).toThrowError(PackError);
  });

  test("runtime: script with non-slug script → error", () => {
    expect(() =>
      parseMarkdownSpec(
        "f",
        doc("name: x\nversion: 1.0.0\ndescription: d\nruntime: script\nscript: 'Has Spaces'\n"),
        validateSkill,
      ),
    ).toThrowError(PackError);
  });
});

const manifest = (capabilities: string[]): PackManifest => ({
  name: "p",
  version: "1.0.0",
  apiLevel: 1,
  capabilities: capabilities as PackManifest["capabilities"],
  contributions: {},
});

const mkPack = (fm: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "pk-"));
  mkdirSync(join(dir, "skills", "s"), { recursive: true });
  writeFileSync(join(dir, "skills", "s", "SKILL.md"), doc(fm));
  return dir;
};

describe("capability gate", () => {
  const scriptFm =
    "name: s\nversion: 1.0.0\ndescription: d\nruntime: script\nscript: lib-script\n";

  test("script skill + declared scripts.run → registers", () => {
    const reg = new ContributionRegistry();
    reg.registerPack("p", mkPack(scriptFm), manifest(["scripts.run"]));
    expect(reg.lookupSkill("p:s")?.view.script).toBe("lib-script");
  });

  test("script skill without scripts.run → CAPABILITY_DENIED at enable", () => {
    const reg = new ContributionRegistry();
    expect(() =>
      reg.registerPack("p", mkPack(scriptFm), manifest([])),
    ).toThrowError(/scripts\.run/);
  });
});

const view = (over: Partial<SkillView> = {}): SkillView => ({
  id: "p:s",
  packId: "p",
  name: "s",
  version: "1.0.0",
  runtime: "script",
  script: "lib-script",
  description: "",
  inputs: {},
  outputs: {},
  params: {},
  guidance: {},
  ...over,
});

const pipeline = (steps: SkillContrib["steps"], outputs: SkillView["outputs"] = {}): SkillContrib => ({
  view: view({ id: "p:pl", name: "pl", runtime: "prompt", script: undefined, outputs }),
  file: "pl/SKILL.md",
  steps,
});

const ctx = (
  skills: Map<string, SkillContrib>,
  runScript?: RunCtx["runScript"],
): RunCtx => ({
  engine: { generate: async () => ({ status: "complete" as const, tokens: 0 }), tokenCount: () => 0 },
  resolveSkill: (ref) => skills.get(ref) ?? null,
  runPipeline: async (pl, inputs, params, path) =>
    executePipeline(pl, inputs, params, "", { ...ctx(skills, runScript), path }),
  runScript,
  path: "p:pl",
});

describe("script step execution", () => {
  const skills = new Map<string, SkillContrib>([["p:s", { view: view(), file: "s/SKILL.md" }]]);
  const pl = pipeline(
    [{ id: "one", uses: "s", inputs: { n: "$params.n" } }],
    { out: { type: "any" } },
  );

  test("step inputs+params bind into args; JSON stdout → output object", async () => {
    let seen: Record<string, unknown> = {};
    const runScript: RunCtx["runScript"] = async (_slug, args) => {
      seen = args;
      return { out: 42 };
    };
    const out = await executePipeline(pl, { n: 3 }, { n: 3 }, "", ctx(skills, runScript));
    expect(seen.n).toBe(3);
    expect(out.out).toBe(42);
  });

  test("absent ctx.runScript → located SCRIPT_NOT_FOUND", async () => {
    await expect(executePipeline(pl, {}, {}, "", ctx(skills))).rejects.toThrowError(
      FabricError,
    );
    try {
      await executePipeline(pl, {}, {}, "", ctx(skills));
    } catch (e) {
      expect((e as FabricError).code).toBe("SCRIPT_NOT_FOUND");
      expect((e as FabricError).path).toBe("p:pl/one");
    }
  });

  test("runScript failure propagates as step failure", async () => {
    const runScript: RunCtx["runScript"] = async () => {
      throw new FabricError("CAPABILITY_DENIED", "denied", "x");
    };
    await expect(executePipeline(pl, {}, {}, "", ctx(skills, runScript))).rejects.toThrowError(
      /denied/,
    );
  });
});
