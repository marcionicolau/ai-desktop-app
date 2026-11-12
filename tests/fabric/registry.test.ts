// feature 017: contribution registry — namespacing, all-or-nothing,
// agent linking, cross-pack refs (T007, T021 partial)
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ContributionRegistry } from "../../src/bun/fabric/registry";
import { parseManifest } from "../../src/bun/fabric/frontmatter";
import { readFileSync } from "node:fs";

const FX = join(import.meta.dir, "../extensions/fixtures");
const manifest = (pack: string) =>
  parseManifest("m", readFileSync(join(FX, pack, "pack.yaml"), "utf8"));

describe("ContributionRegistry", () => {
  test("notes-pack registers skills + pipeline + agent, namespaced", () => {
    const reg = new ContributionRegistry();
    reg.registerPack("notes-pack", join(FX, "notes-pack"), manifest("notes-pack"));
    const c = reg.contributions("notes-pack")!;
    expect(c.skills.map((s) => s.id).sort()).toEqual([
      "notes-pack:action_items",
      "notes-pack:summarize_notes",
    ]);
    expect(c.pipelines[0]?.id).toBe("notes-pack:document_summary");
    expect(c.agents[0]?.id).toBe("notes-pack:note_taker");
    expect(c.agents[0]?.kind).toBe("pipeline");
  });

  test("broken-pack → all-or-nothing: nothing registered", () => {
    const reg = new ContributionRegistry();
    expect(() =>
      reg.registerPack("broken-pack", join(FX, "broken-pack"), manifest("broken-pack")),
    ).toThrowError(/slug-safe/);
    expect(reg.contributions("broken-pack")).toBeNull();
    expect(reg.has("broken-pack")).toBe(false);
  });

  test("same names in two packs do not collide", () => {
    const reg = new ContributionRegistry();
    reg.registerPack("a-pack", join(FX, "notes-pack"), manifest("notes-pack"));
    reg.registerPack("b-pack", join(FX, "notes-pack"), manifest("notes-pack"));
    expect(reg.lookupSkill("a-pack:summarize_notes")?.view.packId).toBe("a-pack");
    expect(reg.lookupSkill("b-pack:summarize_notes")?.view.packId).toBe("b-pack");
  });

  test("unregisterPack removes contributions", () => {
    const reg = new ContributionRegistry();
    reg.registerPack("notes-pack", join(FX, "notes-pack"), manifest("notes-pack"));
    reg.unregisterPack("notes-pack");
    expect(reg.contributions("notes-pack")).toBeNull();
    expect(reg.lookupSkill("notes-pack:summarize_notes")).toBeNull();
  });

  test("readSpec returns frontmatter + body", () => {
    const reg = new ContributionRegistry();
    reg.registerPack("notes-pack", join(FX, "notes-pack"), manifest("notes-pack"));
    const spec = reg.readSpec("notes-pack:summarize_notes")!;
    expect(spec.frontmatter.name).toBe("summarize_notes");
    expect(spec.body).toContain("## Instructions");
    expect(reg.readSpec("notes-pack:nope")).toBeNull();
  });
});
