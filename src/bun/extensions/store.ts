// feature 017: extension pack lifecycle — scan/install/enable/disable/
// remove over dataDir()/extensions + extensions.json state (FR-001..005).
// enable() registers contributions all-or-nothing; scan() re-registers
// already-enabled packs so they survive restart (I1 fix, FR-004).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PackError } from "../fabric/errors";
import { parseManifest } from "../fabric/frontmatter";
import type { ContributionRegistry } from "../fabric/registry";
import { extensionsDir, extensionsStateFile, packDataDir, runsDir } from "../store/paths";
import { fetchPack, sourceRef } from "./fetch";
import type { InstalledPackView, PackSource, PackState } from "../../shared/types";

interface PersistedPack {
  state: PackState;
  source: { kind: PackSource["kind"]; ref: string };
  installedAt: number;
}

export interface InstalledPack extends InstalledPackView {}

export interface ExtensionsStoreDeps {
  registry: ContributionRegistry;
  // aborts the pack's in-flight runs + closes its view sessions (US3/US4)
  onDisable?: (packId: string) => void;
  onRemove?: (packId: string, purgeData: boolean) => void;
}

const slugOk = /^[a-z0-9][a-z0-9_-]*$/;

export class ExtensionsStore {
  private packs = new Map<string, InstalledPack>();

  constructor(private deps: ExtensionsStoreDeps) {}

  private statePath(): string {
    return extensionsStateFile();
  }

  private loadPersisted(): Map<string, PersistedPack> {
    try {
      const raw = JSON.parse(readFileSync(this.statePath(), "utf8"));
      return new Map(Object.entries(raw.packs ?? {}));
    } catch {
      return new Map();
    }
  }

  private persist(): void {
    const packs: Record<string, PersistedPack> = {};
    for (const [id, p] of this.packs) {
      packs[id] = { state: p.state, source: p.source, installedAt: p.installedAt };
    }
    mkdirSync(extensionsDir(), { recursive: true });
    writeFileSync(this.statePath(), JSON.stringify({ packs }, null, 2));
  }

  // Rebuilds in-memory state from disk; re-registers enabled packs'
  // contributions (cold start, FR-004). Failed packs stay listed.
  scan(): InstalledPack[] {
    const persisted = this.loadPersisted();
    this.packs.clear();
    const root = extensionsDir();
    if (!existsSync(root)) return [];
    for (const e of readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const id = e.name;
      const dir = join(root, id);
      const prev = persisted.get(id);
      const pack: InstalledPack = {
        id,
        dir,
        state: prev?.state ?? "installed",
        source: prev?.source ?? { kind: "folder", ref: dir },
        installedAt: prev?.installedAt ?? Date.now(),
        manifest: { name: id, version: "0.0.0", apiLevel: 0, capabilities: [], contributions: {} },
      };
      try {
        pack.manifest = parseManifest(
          join(dir, "pack.yaml"),
          readFileSync(join(dir, "pack.yaml"), "utf8"),
        );
      } catch (err) {
        pack.state = "failed";
        pack.error = located(err);
      }
      this.packs.set(id, pack);
      if (pack.state === "enabled") {
        try {
          this.deps.registry.registerPack(id, dir, pack.manifest);
        } catch (err) {
          pack.state = "failed";
          pack.error = located(err);
        }
      }
    }
    return this.list();
  }

  list(): InstalledPack[] {
    return [...this.packs.values()].map((p) => structuredClone(p));
  }

  get(packId: string): InstalledPack {
    const p = this.packs.get(packId);
    if (!p) throw new PackError("PACK_NOT_FOUND", `no pack "${packId}"`);
    return { ...p };
  }

  private uniqueId(name: string): string {
    const base = slugOk.test(name) ? name : name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "pack";
    let id = base;
    let n = 2;
    while (this.packs.has(id) || existsSync(join(extensionsDir(), id))) {
      id = `${base}-${n++}`;
    }
    return id;
  }

  async install(source: PackSource): Promise<InstalledPack> {
    const staged = await fetchPack(source);
    const existing = [...this.packs.values()].find(
      (p) => p.manifest.name === staged.manifest.name,
    );
    const id = existing ? existing.id : this.uniqueId(staged.manifest.name);
    const dest = join(extensionsDir(), id);
    if (existing?.state === "enabled") {
      // update path: disable first so runs/views/registry stay consistent
      this.disable(id, { uninstall: true });
    }
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(extensionsDir(), { recursive: true });
    cpSync(staged.dir, dest, { recursive: true });
    const pack: InstalledPack = {
      id,
      dir: dest,
      state: "installed", // enable is a separate consent-gated step
      source: { kind: source.kind, ref: sourceRef(source) },
      manifest: staged.manifest,
      installedAt: existing?.installedAt ?? Date.now(),
    };
    this.packs.set(id, pack);
    this.persist();
    return { ...pack };
  }

  async preview(source: PackSource): Promise<{ manifest: InstalledPack["manifest"]; warnings: string[] }> {
    const staged = await fetchPack(source);
    const warnings: string[] = [];
    if ([...this.packs.values()].some((p) => p.manifest.name === staged.manifest.name)) {
      warnings.push(`pack "${staged.manifest.name}" is already installed — install will update it`);
    }
    return { manifest: staged.manifest, warnings };
  }

  enable(packId: string, consent: boolean): InstalledPack {
    const p = this.packs.get(packId);
    if (!p) throw new PackError("PACK_NOT_FOUND", `no pack "${packId}"`);
    if (p.state === "failed") {
      throw new PackError("PACK_INVALID", `pack "${packId}" is failed: ${p.error?.message ?? "?"}`, { file: p.error?.file });
    }
    if (p.state === "enabled") return { ...p };
    if (p.manifest.capabilities.length > 0 && !consent) {
      throw new PackError(
        "INVALID_PARAMS",
        `pack "${packId}" declares capabilities [${p.manifest.capabilities.join(", ")}] — consent required (FR-005)`,
      );
    }
    // all-or-nothing registration happens before the state flips (FR-002)
    this.deps.registry.registerPack(packId, p.dir, p.manifest);
    p.state = "enabled";
    this.persist();
    return { ...p };
  }

  disable(packId: string, opts?: { uninstall?: boolean }): InstalledPack {
    const p = this.packs.get(packId);
    if (!p) throw new PackError("PACK_NOT_FOUND", `no pack "${packId}"`);
    if (p.state === "enabled") {
      this.deps.onDisable?.(packId); // abort runs, close view sessions
      this.deps.registry.unregisterPack(packId);
      p.state = "disabled";
    }
    if (!opts?.uninstall) this.persist();
    return { ...p };
  }

  remove(packId: string, purgeData = false): void {
    const p = this.packs.get(packId);
    if (!p) throw new PackError("PACK_NOT_FOUND", `no pack "${packId}"`);
    if (p.state === "enabled") this.disable(packId);
    this.deps.onRemove?.(packId, purgeData);
    rmSync(p.dir, { recursive: true, force: true });
    if (purgeData) {
      rmSync(packDataDir(packId), { recursive: true, force: true });
      rmSync(runsDir(packId), { recursive: true, force: true });
    }
    this.packs.delete(packId);
    this.persist();
  }
}

function located(err: unknown): InstalledPack["error"] {
  if (err instanceof PackError) {
    return { code: err.code, message: err.message, file: err.file, path: err.path };
  }
  return { code: "PACK_INVALID", message: err instanceof Error ? err.message : String(err) };
}
