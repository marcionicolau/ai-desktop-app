// Model roles: named tags (litellm-style aliases) bound to library models.
// Static resolution orders candidates (binding -> fallback chain); the
// runtime cascade on load failure is layered on by the registry/fusion
// path (T019). Tags persist inside Settings.tags.
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { RpcErrorCode } from "../../shared/rpc-contract";
import type {
  GenerationParams,
  ModelMeta,
  ModelTag,
  ResolvedRole,
  RoleRef,
  RoleState,
  RoleView,
} from "../../shared/types";
import { DEFAULT_GENERATION } from "../../shared/types";
import { mergeParams, validateParams } from "../llama/params";
import { EngineError } from "../llama/engine";
import { modelsDir, scanModels } from "./library";
import type { StoreLike } from "../rpc/handlers";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_FALLBACK = 3;
const DEFAULT_ROLE = "default";

export class RoleError extends EngineError {
  constructor(code: RpcErrorCode, message: string) {
    super(code, message);
    this.name = "RoleError";
  }
}

export interface RolesDeps {
  store: StoreLike;
  // injectable for tests; defaults to a real library scan
  scan?: () => ModelMeta[];
}

export class RolesService {
  private scan: () => ModelMeta[];

  constructor(private deps: RolesDeps) {
    this.scan = deps.scan ?? scanModels;
  }

  private settings() {
    return this.deps.store.getSettings();
  }

  private save(mutate: (tags: ModelTag[]) => ModelTag[]): void {
    const s = this.settings();
    this.deps.store.saveSettings({ ...s, tags: mutate([...s.tags]) });
  }

  private tag(name: string): ModelTag {
    const t = this.settings().tags.find((entry) => entry.name === name);
    if (!t) throw new RoleError("NOT_FOUND", `role tag not found: ${name}`);
    return t;
  }

  private fileExists(fileName: string): boolean {
    return existsSync(join(modelsDir(), fileName));
  }

  // a binding may be a library basename or an external absolute path
  private bindingPath(binding: string): string | null {
    const p = isAbsolute(binding) || binding.includes("/")
      ? binding
      : join(modelsDir(), binding);
    return existsSync(p) ? p : null;
  }

  list(): RoleView[] {
    const library = new Map(this.scan().map((m) => [m.fileName, m]));
    return this.settings().tags.map((t) => {
      const state: RoleState = !t.binding
        ? "unbound"
        : this.bindingPath(t.binding)
          ? "bound"
          : "broken";
      return Object.assign({}, t, {
        state,
        resolvedFile: t.binding ? library.get(t.binding) : undefined,
      });
    });
  }

  create(input: { name: string; label?: string; description?: string }): ModelTag {
    if (!SLUG_RE.test(input.name) || input.name.length > 32) {
      throw new RoleError(
        "INVALID_PARAMS",
        `invalid tag name "${input.name}" (lowercase slug, e.g. my-role)`,
      );
    }
    const s = this.settings();
    if (s.tags.some((t) => t.name === input.name)) {
      throw new RoleError("ALREADY_EXISTS", `tag already exists: ${input.name}`);
    }
    const tag: ModelTag = {
      name: input.name,
      label: input.label,
      description: input.description,
      binding: null,
      params: {},
      fallback: [],
    };
    this.save((tags) => [...tags, tag]);
    return tag;
  }

  update(input: {
    name: string;
    label?: string;
    description?: string;
    params?: Partial<GenerationParams> | null;
  }): void {
    this.tag(input.name);
    if (input.params !== undefined && input.params !== null) {
      const err = validateParams(input.params);
      if (err) throw new RoleError("INVALID_PARAMS", err);
    }
    this.save((tags) =>
      tags.map((t) =>
        t.name === input.name
          ? {
              ...t,
              label: input.label ?? t.label,
              description: input.description ?? t.description,
              params: input.params === null ? {} : (input.params ?? t.params),
            }
          : t,
      ),
    );
  }

  // consumers: conversations using the tag as planner/executor, other
  // tags' fallback chains. force=true detaches those references.
  delete(name: string, force = false): void {
    const t = this.tag(name);
    const s = this.settings();
    const convConsumers = this.deps.store
      .listConversations()
      .map((c) => this.deps.store.getConversation(c.id))
      .filter(
        (c) => c !== null && (c.plannerTag === name || c.executorTag === name),
      )
      .map((c) => `conversation:${c!.id}`);
    const tagConsumers = s.tags
      .filter((o) => o.fallback.some((r) => r.kind === "tag" && r.name === name))
      .map((o) => `fallback:${o.name}`);
    const consumers = [...convConsumers, ...tagConsumers];
    if (consumers.length > 0 && !force) {
      throw new RoleError(
        "ROLE_IN_USE",
        `tag "${name}" is referenced by ${consumers.join(", ")}`,
      );
    }
    if (consumers.length > 0) {
      for (const c of convConsumers) {
        const id = c.slice("conversation:".length);
        const conv = this.deps.store.getConversation(id);
        if (!conv) continue;
        if (conv.plannerTag === name) conv.plannerTag = DEFAULT_ROLE;
        if (conv.executorTag === name) conv.executorTag = DEFAULT_ROLE;
        this.deps.store.saveConversation(conv);
      }
      this.save((tags) =>
        tags.map((o) => ({
          ...o,
          fallback: o.fallback.filter(
            (r) => !(r.kind === "tag" && r.name === name),
          ),
        })),
      );
    }
    this.save((tags) => tags.filter((o) => o.name !== t.name));
  }

  bind(name: string, fileName: string | null): void {
    this.tag(name);
    let binding: string | null = null;
    if (fileName !== null) {
      const p = isAbsolute(fileName) || fileName.includes("/")
        ? fileName
        : join(modelsDir(), fileName);
      if (!existsSync(p)) {
        throw new RoleError(
          "MODEL_NOT_FOUND",
          `model file not found in library: ${fileName}`,
        );
      }
      // library files bind by basename; external files keep their path
      binding = p.startsWith(modelsDir()) ? p.split("/").pop()! : p;
    }
    this.save((tags) =>
      tags.map((t) => (t.name === name ? { ...t, binding } : t)),
    );
    // keep `default` and activeModelPath synced both directions (FR-010)
    if (name === DEFAULT_ROLE) {
      this.deps.store.saveSettings({
        ...this.settings(),
        activeModelPath: binding ? this.bindingPath(binding) : null,
      });
    }
  }

  setFallback(name: string, chain: RoleRef[]): void {
    this.tag(name); // existence check (throws NOT_FOUND)
    if (chain.length > MAX_FALLBACK) {
      throw new RoleError(
        "INVALID_PARAMS",
        `fallback chain too long (max ${MAX_FALLBACK})`,
      );
    }
    const s = this.settings();
    const names = new Set(s.tags.map((o) => o.name));
    // transitive cycle check: tag ref reaching `name` through existing
    // chains would loop the resolver
    const reaches = (from: string, visited: Set<string>): boolean => {
      if (from === name) return true;
      if (visited.has(from)) return false;
      visited.add(from);
      const ft = s.tags.find((o) => o.name === from);
      if (!ft) return false;
      return ft.fallback.some(
        (r) => r.kind === "tag" && reaches(r.name, visited),
      );
    };
    for (const r of chain) {
      if (r.kind === "tag") {
        if (r.name === name || reaches(r.name, new Set([name]))) {
          throw new RoleError(
            "INVALID_PARAMS",
            `fallback cycle involving tag "${r.name}"`,
          );
        }
        if (!names.has(r.name)) {
          throw new RoleError("NOT_FOUND", `fallback tag not found: ${r.name}`);
        }
      } else if (!r.fileName.endsWith(".gguf")) {
        throw new RoleError(
          "INVALID_PARAMS",
          `fallback model must be a .gguf file: ${r.fileName}`,
        );
      }
      // model refs are lazy: a missing file just never resolves, which
      // lets users pre-configure fallbacks for models not downloaded yet
    }
    this.save((tags) =>
      tags.map((o) => (o.name === name ? { ...o, fallback: chain } : o)),
    );
  }

  // Static resolution (T004): binding first, then ordered fallback refs.
  // Runtime load-failure cascade is T019 — resolve() returns the first
  // candidate whose file exists, or throws ROLE_UNBOUND.
  resolve(name: string, persona?: Partial<GenerationParams> | null): ResolvedRole {
    const c = this.resolveCandidates(name, 0, persona)[0];
    if (!c) throw new RoleError("ROLE_UNBOUND", `role "${name}" has no bound model`);
    return c;
  }

  // Ordered candidates (binding -> chain) with resolvable files; missing
  // files are skipped lazily. Runtime callers walk this list on failure.
  // feature 006: persona params slot between global defaults and the
  // per-model/tag overrides — DEFAULT < global < persona < override < tag
  resolveCandidates(
    name: string,
    depth = 0,
    persona?: Partial<GenerationParams> | null,
  ): ResolvedRole[] {
    const t = this.tag(name);
    if (depth > MAX_FALLBACK) return [];
    const settings = this.settings();
    const paramsFor = (fileName: string): GenerationParams =>
      mergeParams(
        mergeParams(
          mergeParams(
            mergeParams(DEFAULT_GENERATION, settings.generation),
            persona,
          ),
          settings.modelOverrides?.[fileName],
        ),
        t.params,
      );

    const out: ResolvedRole[] = [];
    if (t.binding) {
      const p = this.bindingPath(t.binding);
      if (p) {
        out.push({
          tag: name,
          fileName: p.split("/").pop()!,
          path: p,
          params: paramsFor(p.split("/").pop()!),
          servedBy: { kind: "primary" },
        });
      }
    }
    const visited = new Set<string>([name]);
    for (const ref of t.fallback) {
      if (ref.kind === "model") {
        const p = join(modelsDir(), ref.fileName);
        if (existsSync(p)) {
          out.push({
            tag: name,
            fileName: ref.fileName,
            path: p,
            params: paramsFor(ref.fileName),
            servedBy: { kind: "fallback", via: ref },
          });
        }
        continue;
      }
      if (visited.has(ref.name)) continue;
      visited.add(ref.name);
      try {
        for (const inner of this.resolveCandidates(ref.name, depth + 1, persona)) {
          out.push({
            ...inner,
            tag: name,
            params: mergeParams(inner.params, t.params),
            servedBy: { kind: "fallback", via: ref },
          });
        }
      } catch (e) {
        // dangling or unresolvable refs are skipped, never fatal
        if (
          e instanceof RoleError &&
          (e.code === "ROLE_UNBOUND" || e.code === "NOT_FOUND")
        ) {
          continue;
        }
        throw e;
      }
    }
    return out;
  }
}
