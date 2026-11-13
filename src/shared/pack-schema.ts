// feature 017: extension pack schema — manifest + SKILL/AGENT frontmatter
// types shared by the bun-side loader/validators and RPC-facing views.
// Contracts: specs/017-multi-agent-plugin-ui/contracts/pack-format.md.

// Host contract level; a pack's apiLevel must equal this (research D10).
export const API_LEVEL = 1;

export const CAPABILITIES = [
  "models.generate",
  "storage",
  "runs.read",
  "views.theme",
  "commands.invoke",
  // feature 023: script-backed pipeline steps (runtime: "script")
  "scripts.run",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type PortType = "text" | "json" | "number" | "any" | "list";

export interface PortDecl {
  type: PortType;
  constraints?: Record<string, unknown>;
}

export interface ParamDecl {
  required?: boolean;
  default?: unknown;
  description?: string;
}

export interface ViewDecl {
  id: string;
  title: string;
  slot: "tab" | "panel";
  entry: string; // e.g. "views/results/index.html"
  minWidth?: number;
  minHeight?: number;
}

export interface CommandDecl {
  id: string;
  title: string;
  description?: string;
  run: { pipeline?: string; agent?: string; params?: Record<string, unknown> };
}

export interface PackContributions {
  skillsDir?: string; // default "skills"
  agentsDir?: string; // default "config/agents"
  views?: ViewDecl[];
  commands?: CommandDecl[];
}

export interface PackManifest {
  name: string; // slug-safe [a-z0-9-]
  version: string; // semver-ish
  apiLevel: number;
  description?: string;
  capabilities: Capability[]; // absent in yaml → []
  contributions: PackContributions;
}

// ---- SKILL.md frontmatter (spec-agents subset, contracts/pack-format.md) ----

export interface SkillFrontmatter {
  name: string;
  version: string;
  domain?: string;
  description: string;
  kind?: "pipeline"; // absent = component
  runtime?: string; // "prompt" | "component:<builtin-id>" | "script"
  script?: string; // feature 023: library slug, required when runtime:"script"
  params?: Record<string, ParamDecl>;
  inputs?: Record<string, PortDecl>;
  outputs?: Record<string, PortDecl>;
  prompt?: { model?: string; temperature?: number; grounding?: boolean };
  // kind: pipeline only
  steps?: PipelineStepDecl[];
}

export interface PipelineStepDecl {
  id: string;
  uses: string; // local name or <pack>:<name>
  params?: Record<string, unknown>;
  inputs?: Record<string, string>; // port -> "<stepId>.<port>" | "$objective" | "$params.<k>"
}

// ---- AGENT.md frontmatter ----

export type AgentKind = "router" | "sequential" | "planner" | "llm" | "pipeline";

export interface AgentFrontmatter {
  name: string;
  kind: AgentKind;
  model?: string; // host role tag, resolved via roles service
  children?: string[]; // router/sequential only
  fallback?: string;
  budget?: { maxDepth?: number; maxDelegations?: number; maxModelCalls?: number };
  pipeline?: string; // kind: pipeline only
}

// ---- builtins whitelisted for runtime: component:<id> (research D6) ----

export const BUILTIN_COMPONENTS = [
  "text.concat",
  "text.template",
  "json.extract",
  "list.map",
  "list.filter",
  "const",
] as const;

export type BuiltinComponentId = (typeof BUILTIN_COMPONENTS)[number];
