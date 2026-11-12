// feature 017 (T021): contract edge cases not covered by
// frontmatter.test.ts — component: runtime whitelist, unknown step refs,
// and agent-tree cycles rejected at registration (all-or-nothing).
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSkill } from "../../src/bun/fabric/frontmatter";
import { ContributionRegistry } from "../../src/bun/fabric/registry";

const base = { name: "s", version: "1.0.0", description: "d" };

describe("skill contract", () => {
  test("component:<builtin> runtime accepted; non-builtin rejected", () => {
    expect(() =>
      validateSkill({ ...base, runtime: "component:text.concat" }, "f"),
    ).not.toThrow();
    expect(() =>
      validateSkill({ ...base, runtime: "component:evil.exec" }, "f"),
    ).toThrowError(/component:<builtin>/);
  });

  test("pipeline step ref to unknown step id → located error", () => {
    expect(() =>
      validateSkill(
        {
          ...base,
          kind: "pipeline",
          steps: [{ id: "a", uses: "x", inputs: { in: "ghost.out" } }],
        },
        "f",
      ),
    ).toThrowError(/unknown step ref/);
  });
});

describe("agent tree", () => {
  const writePack = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "cyclic-"));
    mkdirSync(join(dir, "config/agents/a"), { recursive: true });
    mkdirSync(join(dir, "config/agents/b"), { recursive: true });
    writeFileSync(join(dir, "pack.yaml"), "name: cyc\nversion: 1.0.0\napiLevel: 1\n");
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(dir, `config/agents/${name}/AGENT.md`), body);
    }
    return dir;
  };

  test("cycle across agents → PACK_INVALID naming the node", () => {
    const dir = writePack({
      a: "---\nname: a\nkind: sequential\nchildren: [b]\n---\na",
      b: "---\nname: b\nkind: sequential\nchildren: [a]\n---\nb",
    });
    const reg = new ContributionRegistry();
    expect(() =>
      reg.registerPack("cyc", dir, {
        name: "cyc", version: "1.0.0", apiLevel: 1, capabilities: [], contributions: {},
      }),
    ).toThrowError(/cycle/);
    expect(reg.contributions("cyc")).toBeNull();
  });
});
