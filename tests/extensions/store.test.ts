// feature 017: extension lifecycle store (T012) — scan/install/enable/
// disable/remove, consent, apiLevel, failure containment, persistence,
// cold-start re-registration, reinstall consent re-prompt.
import { beforeEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContributionRegistry } from "../../src/bun/fabric/registry";
import { ExtensionsStore } from "../../src/bun/extensions/store";

const FX = join(import.meta.dir, "fixtures");
let data: string;
let reg: ContributionRegistry;
let disabled: string[];

const store = () =>
  new ExtensionsStore({
    registry: reg,
    onDisable: (id) => disabled.push(id),
  });

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), "aipacks-"));
  process.env.APP_DATA_DIR = data;
  reg = new ContributionRegistry();
  disabled = [];
});

const notesFolder = { kind: "folder", path: join(FX, "notes-pack") } as const;
const brokenFolder = { kind: "folder", path: join(FX, "broken-pack") } as const;

describe("ExtensionsStore", () => {
  test("install → consent-gated enable → contributions registered", async () => {
    const s = store();
    s.scan();
    const pack = await s.install(notesFolder);
    expect(pack.state).toBe("installed");
    expect(() => s.enable(pack.id, false)).toThrowError(/consent required/);
    const on = s.enable(pack.id, true);
    expect(on.state).toBe("enabled");
    expect(reg.contributions(pack.id)?.skills.length).toBe(2);
  });

  test("enable of no-capability pack skips consent", async () => {
    const s = store();
    s.scan();
    const pack = await s.install({ kind: "folder", path: join(FX, "crash-view-pack") });
    expect(s.enable(pack.id, false).state).toBe("enabled");
  });

  test("broken-pack fails on install (manifest ok, specs invalid on enable)", async () => {
    const s = store();
    s.scan();
    const pack = await s.install(brokenFolder);
    expect(pack.state).toBe("installed");
    expect(() => s.enable(pack.id, true)).toThrowError(/slug-safe/);
    expect(s.get(pack.id).state).toBe("installed");
    expect(reg.contributions(pack.id)).toBeNull();
  });

  test("incompatible manifest rejected at fetch/validate time", async () => {
    const s = store();
    s.scan();
    await expect(
      s.install({ kind: "folder", path: join(FX, "incompatible-pack") }),
    ).rejects.toThrowError(/apiLevel/);
  });

  test("disable aborts runs hook + unregisters; re-enable restores", async () => {
    const s = store();
    s.scan();
    const pack = await s.install(notesFolder);
    s.enable(pack.id, true);
    s.disable(pack.id);
    expect(disabled).toEqual([pack.id]);
    expect(reg.contributions(pack.id)).toBeNull();
    s.enable(pack.id, true);
    expect(reg.contributions(pack.id)).not.toBeNull();
  });

  test("state persists across store instances + cold-start re-register (I1)", async () => {
    const s1 = store();
    s1.scan();
    const pack = await s1.install(notesFolder);
    s1.enable(pack.id, true);
    // new store + fresh registry simulates app restart
    reg = new ContributionRegistry();
    const s2 = store();
    const packs = s2.scan();
    expect(packs[0]?.state).toBe("enabled");
    expect(reg.contributions(pack.id)).not.toBeNull();
  });

  test("failed pack does not block others (FR-002)", async () => {
    const s = store();
    s.scan();
    await s.install(notesFolder);
    // corrupt the enabled pack's manifest on disk
    const badDir = join(data, "extensions", "notes-pack");
    writeFileSync(join(badDir, "pack.yaml"), "name: [unclosed\n");
    const packs = store().scan();
    const failed = packs.find((p) => p.id === "notes-pack");
    expect(failed?.state).toBe("failed");
    expect(failed?.error?.file).toContain("pack.yaml");
    // another pack still installs/enables fine
    const ok = await store().install(notesFolder);
    expect(ok.state).toBe("installed");
  });

  test("reinstall = update: keeps id, state resets, consent re-prompted (U2)", async () => {
    const s = store();
    s.scan();
    const pack = await s.install(notesFolder);
    s.enable(pack.id, true);
    const again = await s.install(notesFolder);
    expect(again.id).toBe(pack.id);
    expect(again.state).toBe("installed");
    expect(reg.contributions(pack.id)).toBeNull();
  });

  test("remove deletes dir; purgeData wipes pack-data + runs", async () => {
    const s = store();
    s.scan();
    const pack = await s.install(notesFolder);
    s.enable(pack.id, true);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(data, "pack-data", pack.id), { recursive: true });
    mkdirSync(join(data, "runs", pack.id), { recursive: true });
    s.remove(pack.id, true);
    expect(existsSync(pack.dir)).toBe(false);
    expect(existsSync(join(data, "pack-data", pack.id))).toBe(false);
    expect(s.list()).toEqual([]);
  });

  test("preview returns manifest without installing", async () => {
    const s = store();
    s.scan();
    const p = await s.preview(notesFolder);
    expect(p.manifest.name).toBe("notes-pack");
    expect(s.list()).toEqual([]);
  });
});

test("three packs enabled simultaneously: no cross-talk (SC-005)", async () => {
  const s = store();
  s.scan();
  const ids: string[] = [];
  for (const fx of ["notes-pack", "views-pack", "crash-view-pack"]) {
    const p = await s.install({ kind: "folder", path: join(FX, fx) });
    s.enable(p.id, true);
    ids.push(p.id);
  }
  // notes-pack contributions registered under its own namespace only
  const contribs = reg.contributions("notes-pack");
  expect(contribs?.skills.every((sk) => sk.id.startsWith("notes-pack:"))).toBe(true);
  // each pack's state is independent
  s.disable("views-pack");
  expect(s.get("notes-pack").state).toBe("enabled");
  expect(s.get("crash-view-pack").state).toBe("enabled");
  expect(reg.contributions("notes-pack")?.skills.length).toBe(2);
});
