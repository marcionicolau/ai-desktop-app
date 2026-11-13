// feature 017: contribution registry — loads a pack's SKILL.md/AGENT.md
// files into namespaced contribution descriptors (<packId>:<name>, FR-006).
// Registration is all-or-nothing (FR-002): any invalid file rejects the
// whole pack before anything becomes visible.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PackError } from "./errors";
import {
  parseYamlDoc,
  readSpecFile,
  validateAgent,
  validateSkill,
} from "./frontmatter";
import type { AgentFrontmatter, PackManifest } from "../../shared/pack-schema";
import type {
  AgentView,
  PackContributionsView,
  PipelineView,
  SkillView,
} from "../../shared/types";

export interface SkillContrib {
  view: SkillView;
  file: string;
  steps?: PipelineView["steps"]; // pipelines share the skill frontmatter
  instructions?: string; // runtime: prompt template (## Instructions)
  promptCfg?: { model?: string; temperature?: number; grounding?: boolean };
}

export interface AgentContrib {
  view: AgentView;
  file: string;
  body: string; // system prompt guidance
  fm: AgentFrontmatter;
}

export interface PackContribs {
  skills: Map<string, SkillContrib>; // namespaced id -> contrib
  pipelines: Map<string, SkillContrib>;
  agents: Map<string, AgentContrib>;
}

const ns = (packId: string, name: string) => `${packId}:${name}`;

function* mdFiles(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* mdFiles(p);
    else if (e.name === "SKILL.md" || e.name === "AGENT.md") yield p;
  }
}

export class ContributionRegistry {
  private packs = new Map<string, PackContribs>();

  has(packId: string): boolean {
    return this.packs.has(packId);
  }

  // Loads + validates every spec file; throws the first located PackError.
  registerPack(packId: string, dir: string, manifest: PackManifest): void {
    const skills = new Map<string, SkillContrib>();
    const pipelines = new Map<string, SkillContrib>();
    const agents = new Map<string, AgentContrib>();
    const skillsDir = join(dir, manifest.contributions.skillsDir ?? "skills");
    const agentsDir = join(dir, manifest.contributions.agentsDir ?? "config/agents");
    try {
      for (const file of mdFiles(skillsDir)) {
        const spec = readSpecFile(file, validateSkill);
        const fm = spec.frontmatter;
        // feature 023: runtime:"script" skills execute library scripts —
        // the pack must declare the scripts.run capability (pack-script.md)
        if (fm.runtime === "script" && !manifest.capabilities.includes("scripts.run")) {
          throw new PackError(
            "CAPABILITY_DENIED",
            `skill "${fm.name}" uses runtime "script" but the pack does not declare "scripts.run"`,
            { file, path: "runtime" },
          );
        }
        const id = ns(packId, fm.name);
        if (skills.has(id) || pipelines.has(id)) {
          throw new PackError("PACK_INVALID", `duplicate contribution "${fm.name}"`, { file, path: "name" });
        }
        const view: SkillView = {
          id, packId, name: fm.name, domain: fm.domain, version: fm.version,
          runtime: fm.runtime ?? "prompt", description: fm.description,
          inputs: fm.inputs ?? {}, outputs: fm.outputs ?? {},
          params: fm.params ?? {}, script: fm.script,
          guidance: {
            whenToUse: spec.sections["when to use"],
            interpreting: spec.sections["interpreting"],
            mistakes: spec.sections["common mistakes"],
          },
        };
        const contrib: SkillContrib = {
          view, file, steps: fm.steps,
          instructions: spec.sections["instructions"],
          promptCfg: fm.prompt,
        };
        if (fm.kind === "pipeline") pipelines.set(id, contrib);
        else skills.set(id, contrib);
      }
      for (const file of mdFiles(agentsDir)) {
        const spec = readSpecFile(file, validateAgent);
        const fm = spec.frontmatter;
        const id = ns(packId, fm.name);
        if (agents.has(id)) {
          throw new PackError("PACK_INVALID", `duplicate agent "${fm.name}"`, { file, path: "name" });
        }
        agents.set(id, {
          view: {
            id, packId, name: fm.name, kind: fm.kind, model: fm.model,
            children: [], // linked after all files load
            fallback: fm.fallback, pipeline: fm.pipeline,
          },
          file,
          body: spec.body,
          fm,
        });
      }
      // link agent children + validate refs/cycles
      for (const [, a] of agents) {
        const fm = a.fm;
        for (const child of fm.children ?? []) {
          const cid = child.includes(":") ? child : ns(packId, child);
          const target = agents.get(cid) ?? this.lookupAgentContrib(cid);
          if (!target) {
            throw new PackError("PACK_INVALID", `agent "${fm.name}" references unknown child "${child}"`, { file: a.file, path: "children" });
          }
          a.view.children.push(target.view);
        }
        if (fm.pipeline) {
          const pid = fm.pipeline.includes(":") ? fm.pipeline : ns(packId, fm.pipeline);
          if (!pipelines.has(pid) && !this.packs.get(pid.split(":")[0] as string)?.pipelines.has(pid)) {
            throw new PackError("PACK_INVALID", `agent "${fm.name}" references unknown pipeline "${fm.pipeline}"`, { file: a.file, path: "pipeline" });
          }
        }
      }
      this.assertAcyclic(agents);
    } catch (e) {
      // all-or-nothing: annotate pack origin then bail (FR-002)
      if (e instanceof PackError) throw e;
      throw e;
    }
    this.packs.set(packId, { skills, pipelines, agents });
  }

  private assertAcyclic(agents: Map<string, AgentContrib>): void {
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (id: string, a: AgentContrib) => {
      if (done.has(id)) return;
      if (visiting.has(id)) {
        throw new PackError("PACK_INVALID", `agent tree cycle at "${id}"`, { file: a.file, path: "children" });
      }
      visiting.add(id);
      for (const c of a.view.children) {
        const child = agents.get(c.id) ?? this.lookupAgentContrib(c.id);
        if (child) visit(c.id, child);
      }
      visiting.delete(id);
      done.add(id);
    };
    for (const [id, a] of agents) visit(id, a);
  }

  unregisterPack(packId: string): void {
    this.packs.delete(packId);
  }

  lookupSkill(id: string): SkillContrib | null {
    const pack = this.packs.get(id.split(":")[0] as string);
    return pack?.skills.get(id) ?? pack?.pipelines.get(id) ?? null;
  }

  lookupAgent(id: string): AgentContrib["view"] | null {
    return this.lookupAgentContrib(id)?.view ?? null;
  }

  lookupAgentContrib(id: string): AgentContrib | null {
    const pack = this.packs.get(id.split(":")[0] as string);
    return pack?.agents.get(id) ?? null;
  }

  contributions(packId: string): PackContributionsView | null {
    const pack = this.packs.get(packId);
    if (!pack) return null;
    return {
      skills: [...pack.skills.values()].map((c) => c.view),
      pipelines: [...pack.pipelines.values()].map((c) => ({
        id: c.view.id, packId, name: c.view.name,
        description: c.view.description, inputs: c.view.inputs, steps: c.steps ?? [],
      })),
      agents: [...pack.agents.values()].map((c) => c.view),
      views: [],
      commands: [],
    };
  }

  readSpec(id: string): { frontmatter: Record<string, unknown>; body: string } | null {
    const skill = this.lookupSkill(id);
    const agent = this.lookupAgentContrib(id);
    const file = skill?.file ?? agent?.file;
    if (!file) return null;
    const text = readFileSync(file, "utf8");
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    if (!m) return null;
    return {
      frontmatter: parseYamlDoc(file, m[1] as string),
      body: text.slice(m[0].length).trim(),
    };
  }

  listPacks(): string[] {
    return [...this.packs.keys()];
  }
}
