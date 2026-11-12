// feature 017: YAML frontmatter parsing + structural contract validation
// for pack.yaml manifests, SKILL.md components/pipelines and AGENT.md
// agent nodes. Frontmatter = contract (validated at registration, all
// errors located); body = guidance (extracted sections).
import { readFileSync } from "node:fs";
import { PackError } from "./errors";
import {
  API_LEVEL,
  BUILTIN_COMPONENTS,
  CAPABILITIES,
  type AgentFrontmatter,
  type PackManifest,
  type PipelineStepDecl,
  type PortDecl,
  type SkillFrontmatter,
} from "../../shared/pack-schema";

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface ParsedSpec<T> {
  frontmatter: T;
  body: string;
  sections: Record<string, string>;
}

function bad(file: string, path: string, msg: string): never {
  throw new PackError("PACK_INVALID", msg, { file, path });
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function reqStr(v: unknown, file: string, path: string): string {
  if (typeof v !== "string" || v.length === 0) {
    bad(file, path, `expected non-empty string, got ${JSON.stringify(v)}`);
  }
  return v as string;
}

const SLUG = /^[a-z0-9][a-z0-9_-]*$/;

function version(v: unknown, file: string, path: string): string {
  if (typeof v === "number") return String(v);
  return reqStr(v, file, path);
}

export function parseYamlDoc(file: string, text: string): Record<string, unknown> {
  let doc: unknown;
  try {
    doc = Bun.YAML.parse(text);
  } catch (e) {
    bad(file, "", `invalid YAML: ${e instanceof Error ? e.message : e}`);
  }
  if (!isObj(doc)) bad(file, "", "document must be a YAML mapping");
  return doc as Record<string, unknown>;
}

// --- manifest ---

export function parseManifest(file: string, text: string): PackManifest {
  const doc = parseYamlDoc(file, text);
  const name = reqStr(doc.name, file, "name");
  if (!SLUG.test(name)) {
    bad(file, "name", `must be slug-safe [a-z0-9-_], got "${name}"`);
  }
  version(doc.version, file, "version");
  if (doc.apiLevel !== API_LEVEL) {
    throw new PackError(
      "PACK_INCOMPATIBLE",
      `pack apiLevel ${JSON.stringify(doc.apiLevel)} != host ${API_LEVEL}`,
      { file, path: "apiLevel" },
    );
  }
  const caps = doc.capabilities ?? [];
  if (!Array.isArray(caps)) bad(file, "capabilities", "must be a list");
  for (const c of caps) {
    if (!(CAPABILITIES as readonly string[]).includes(c as string)) {
      bad(file, "capabilities", `unknown capability ${JSON.stringify(c)}`);
    }
  }
  const contribs = isObj(doc.contributions) ? doc.contributions : {};
  const views = contribs.views ?? [];
  const commands = contribs.commands ?? [];
  if (!Array.isArray(views)) bad(file, "contributions.views", "must be a list");
  if (!Array.isArray(commands)) {
    bad(file, "contributions.commands", "must be a list");
  }
  for (const [i, v] of views.entries()) {
    const p = `contributions.views[${i}]`;
    if (!isObj(v)) bad(file, p, "must be a mapping");
    reqStr(v.id, file, `${p}.id`);
    reqStr(v.title, file, `${p}.title`);
    if (v.slot !== "tab" && v.slot !== "panel") {
      bad(file, `${p}.slot`, 'must be "tab" or "panel"');
    }
    const entry = reqStr(v.entry, file, `${p}.entry`);
    if (entry.includes("..") || entry.startsWith("/")) {
      bad(file, `${p}.entry`, "must be a pack-relative path");
    }
  }
  for (const [i, c] of commands.entries()) {
    const p = `contributions.commands[${i}]`;
    if (!isObj(c)) bad(file, p, "must be a mapping");
    reqStr(c.id, file, `${p}.id`);
    reqStr(c.title, file, `${p}.title`);
    if (!isObj(c.run) || (c.run.pipeline == null && c.run.agent == null)) {
      bad(file, `${p}.run`, "must declare pipeline or agent");
    }
  }
  return {
    name,
    version: version(doc.version, file, "version"),
    apiLevel: API_LEVEL,
    description: typeof doc.description === "string" ? doc.description : undefined,
    capabilities: caps as PackManifest["capabilities"],
    contributions: {
      skillsDir: typeof contribs.skillsDir === "string" ? contribs.skillsDir : undefined,
      agentsDir: typeof contribs.agentsDir === "string" ? contribs.agentsDir : undefined,
      views: views as PackManifest["contributions"]["views"],
      commands: commands as PackManifest["contributions"]["commands"],
    },
  };
}

// --- markdown spec files ---

function extractSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const re = /^## (.+)$/gm;
  const marks = [...body.matchAll(re)];
  for (const [i, m] of marks.entries()) {
    const title = (m[1] as string).trim().toLowerCase();
    const start = (m.index ?? 0) + m[0].length;
    const end = marks[i + 1]?.index ?? body.length;
    sections[title] = body.slice(start, end).trim();
  }
  return sections;
}

export function parseMarkdownSpec<T>(
  file: string,
  text: string,
  validate: (doc: Record<string, unknown>, file: string) => T,
): ParsedSpec<T> {
  const m = FM_RE.exec(text);
  if (!m) bad(file, "", "missing YAML frontmatter block");
  const doc = parseYamlDoc(file, m[1] as string);
  const body = text.slice(m[0].length);
  return {
    frontmatter: validate(doc, file),
    body,
    sections: extractSections(body),
  };
}

const PORT_TYPES = new Set(["text", "json", "number", "any", "list"]);

function ports(v: unknown, file: string, path: string): Record<string, PortDecl> {
  if (v == null) return {};
  if (!isObj(v)) bad(file, path, "must be a mapping of port -> {type}");
  const out: Record<string, PortDecl> = {};
  for (const [k, d] of Object.entries(v)) {
    if (!isObj(d) || typeof d.type !== "string" || !PORT_TYPES.has(d.type)) {
      bad(file, `${path}.${k}`, `port type must be one of ${[...PORT_TYPES].join("|")}`);
    }
    out[k] = { type: d.type as PortDecl["type"], constraints: isObj(d.constraints) ? d.constraints : undefined };
  }
  return out;
}

// --- skill / pipeline frontmatter ---

export function validateSkill(doc: Record<string, unknown>, file: string): SkillFrontmatter {
  const name = reqStr(doc.name, file, "name");
  if (!SLUG.test(name)) bad(file, "name", `must be slug-safe, got "${name}"`);
  version(doc.version, file, "version");
  reqStr(doc.description, file, "description");
  const isPipeline = doc.kind === "pipeline";
  if (doc.kind != null && doc.kind !== "pipeline") {
    bad(file, "kind", `must be "pipeline" or absent, got ${JSON.stringify(doc.kind)}`);
  }
  const runtime = doc.runtime == null ? "prompt" : reqStr(doc.runtime, file, "runtime");
  if (!isPipeline) {
    if (runtime !== "prompt") {
      const id = runtime.startsWith("component:") ? runtime.slice("component:".length) : null;
      if (!id || !(BUILTIN_COMPONENTS as readonly string[]).includes(id)) {
        bad(file, "runtime", `must be "prompt" or "component:<builtin>" (${BUILTIN_COMPONENTS.join(", ")})`);
      }
    }
  }
  let steps: PipelineStepDecl[] | undefined;
  if (isPipeline) {
    if (!Array.isArray(doc.steps) || doc.steps.length === 0) {
      bad(file, "steps", "pipeline requires a non-empty steps list");
    }
    const ids = new Set<string>();
    steps = (doc.steps as unknown[]).map((s, i) => {
      const p = `steps[${i}]`;
      if (!isObj(s)) bad(file, p, "must be a mapping");
      const id = reqStr(s.id, file, `${p}.id`);
      if (ids.has(id)) bad(file, `${p}.id`, `duplicate step id "${id}"`);
      ids.add(id);
      reqStr(s.uses, file, `${p}.uses`);
      const inputs = isObj(s.inputs) ? (s.inputs as Record<string, string>) : undefined;
      if (inputs) {
        for (const [k, ref] of Object.entries(inputs)) {
          if (typeof ref !== "string") bad(file, `${p}.inputs.${k}`, "must be a step/port ref string");
        }
      }
      return { id, uses: s.uses as string, params: isObj(s.params) ? s.params : undefined, inputs };
    });
    // DAG check: input refs must point at earlier steps (implicit topo order)
    for (const [i, s] of steps.entries()) {
      for (const [port, ref] of Object.entries(s.inputs ?? {})) {
        if (ref.startsWith("$")) continue; // $objective / $params.*
        const src = ref.split(".")[0] as string;
        if (!ids.has(src)) bad(file, `steps[${i}].inputs.${port}`, `unknown step ref "${src}"`);
        if (steps.findIndex((x) => x.id === src) >= i) {
          bad(file, `steps[${i}].inputs.${port}`, `forward/cyclic ref to "${src}" — steps must be topologically ordered`);
        }
      }
    }
  }
  return {
    name,
    version: version(doc.version, file, "version"),
    domain: typeof doc.domain === "string" ? doc.domain : undefined,
    description: doc.description as string,
    kind: isPipeline ? "pipeline" : undefined,
    runtime,
    params: isObj(doc.params) ? (doc.params as SkillFrontmatter["params"]) : undefined,
    inputs: ports(doc.inputs, file, "inputs"),
    outputs: ports(doc.outputs, file, "outputs"),
    prompt: isObj(doc.prompt) ? (doc.prompt as SkillFrontmatter["prompt"]) : undefined,
    steps,
  };
}

// --- agent frontmatter ---

const AGENT_KINDS = new Set(["router", "sequential", "planner", "llm", "pipeline"]);

export function validateAgent(doc: Record<string, unknown>, file: string): AgentFrontmatter {
  const name = reqStr(doc.name, file, "name");
  if (!SLUG.test(name)) bad(file, "name", `must be slug-safe, got "${name}"`);
  const kind = reqStr(doc.kind, file, "kind") as AgentFrontmatter["kind"];
  if (!AGENT_KINDS.has(kind)) {
    bad(file, "kind", `must be one of ${[...AGENT_KINDS].join("|")}`);
  }
  const children = doc.children == null ? [] : doc.children;
  if (!Array.isArray(children) || children.some((c) => typeof c !== "string")) {
    bad(file, "children", "must be a list of agent names");
  }
  if (children.length > 0 && kind !== "router" && kind !== "sequential") {
    bad(file, "children", `kind "${kind}" cannot have children`);
  }
  if (kind === "pipeline" && typeof doc.pipeline !== "string") {
    bad(file, "pipeline", 'kind "pipeline" requires a pipeline name');
  }
  if (kind === "router" && (children as string[]).length === 0) {
    bad(file, "children", 'kind "router" requires children');
  }
  return {
    name,
    kind,
    model: typeof doc.model === "string" ? doc.model : undefined,
    children: children as string[],
    fallback: typeof doc.fallback === "string" ? doc.fallback : undefined,
    budget: isObj(doc.budget) ? (doc.budget as AgentFrontmatter["budget"]) : undefined,
    pipeline: typeof doc.pipeline === "string" ? doc.pipeline : undefined,
  };
}

export function readSpecFile<T>(
  file: string,
  validate: (doc: Record<string, unknown>, file: string) => T,
): ParsedSpec<T> {
  return parseMarkdownSpec(file, readFileSync(file, "utf8"), validate);
}
