// feature 006: personas + snippets — settings-resident CRUD with
// seed-on-read semantics (unset → starters; explicit [] stays empty).
// Same injectable {store} pattern as RolesService.
import type { RpcErrorCode } from "../../shared/rpc-contract";
import type { Persona, Snippet } from "../../shared/types";
import { validateParams } from "../llama/params";
import { EngineError } from "../llama/engine";
import { STARTER_PERSONAS as STARTER } from "./seed";
import type { StoreLike } from "../rpc/handlers";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_PROMPT_BYTES = 8 * 1024;
const MAX_SNIPPET_BYTES = 4 * 1024;

export class PersonaError extends EngineError {
  constructor(code: RpcErrorCode, message: string) {
    super(code, message);
    this.name = "PersonaError";
  }
}

// settings access goes through StoreLike; listConversations returns
// summaries so usage() doesn't parse every file — delete() needs the
// full conversations though, so it accepts a getConversation dep.
export interface PersonaDeps {
  store: StoreLike;
  // tag names for preferredTag validation; absent = no validation
  tagNames?: () => string[];
  getConversation?: StoreLike["getConversation"];
  saveConversation?: StoreLike["saveConversation"];
}

export class PersonaService {
  constructor(private deps: PersonaDeps) {}

  private settings() {
    return this.deps.store.getSettings();
  }

  private save(patch: Partial<import("../../shared/types").Settings>): void {
    this.deps.store.saveSettings({ ...this.settings(), ...patch });
  }

  // seed-on-read: undefined → materialize starters; [] stays [] (D2)
  private personasSeeded(): Persona[] {
    const p = this.settings().personas;
    if (p !== undefined) return p;
    const starters = STARTER.map((s) => ({ ...s }));
    this.save({ personas: starters });
    return starters;
  }

  private validSlug(name: string): void {
    if (!SLUG_RE.test(name) || name.length > 32) {
      throw new PersonaError(
        "INVALID_PARAMS",
        `name must be a lowercase slug (a-z0-9-): ${name}`,
      );
    }
  }

  private validatePersona(p: Persona, isUpdate: boolean): void {
    this.validSlug(p.name);
    if (!isUpdate && this.personasSeeded().some((x) => x.name === p.name)) {
      throw new PersonaError("INVALID_PARAMS", `persona exists: ${p.name}`);
    }
    const bytes = Buffer.byteLength(p.systemPrompt ?? "", "utf8");
    if (bytes === 0) {
      throw new PersonaError("INVALID_PARAMS", "systemPrompt must not be empty");
    }
    if (bytes > MAX_PROMPT_BYTES) {
      throw new PersonaError(
        "INVALID_PARAMS",
        `systemPrompt exceeds ${MAX_PROMPT_BYTES} bytes`,
      );
    }
    if (p.params) {
      const err = validateParams(p.params);
      if (err) throw new PersonaError("INVALID_PARAMS", err);
    }
    if (p.preferredTag && this.deps.tagNames) {
      if (!this.deps.tagNames().includes(p.preferredTag)) {
        throw new PersonaError(
          "INVALID_PARAMS",
          `preferredTag is not a role tag: ${p.preferredTag}`,
        );
      }
    }
  }

  // ---- personas ----

  list(): Persona[] {
    return this.personasSeeded();
  }

  get(name: string): Persona | null {
    return this.personasSeeded().find((p) => p.name === name) ?? null;
  }

  // upsert: same name = update; new name = create (duplicate = client
  // copies under a new slug, same path)
  upsert(p: Persona): Persona {
    const all = this.personasSeeded();
    const exists = all.some((x) => x.name === p.name);
    this.validatePersona(p, exists);
    this.save({
      personas: exists
        ? all.map((x) => (x.name === p.name ? p : x))
        : [...all, p],
    });
    return p;
  }

  usage(name: string): { count: number; titles: string[] } {
    const hits = this.deps.store
      .listConversations()
      .filter((c) => c.personaName === name);
    return { count: hits.length, titles: hits.map((c) => c.title) };
  }

  // clears the assignment on every referencing conversation (D4/SC-004)
  delete(name: string): { cleared: number } {
    const all = this.personasSeeded();
    if (!all.some((p) => p.name === name)) {
      throw new PersonaError("NOT_FOUND", `persona not found: ${name}`);
    }
    this.save({ personas: all.filter((p) => p.name !== name) });
    let cleared = 0;
    if (this.deps.getConversation && this.deps.saveConversation) {
      for (const s of this.deps.store.listConversations()) {
        if (s.personaName !== name) continue;
        const conv = this.deps.getConversation(s.id);
        if (conv) {
          conv.personaName = null;
          this.deps.saveConversation(conv);
          cleared++;
        }
      }
    }
    return { cleared };
  }

  // ---- snippets ----

  snippets(): Snippet[] {
    return this.settings().snippets ?? [];
  }

  upsertSnippet(s: Snippet): Snippet {
    this.validSlug(s.name);
    if (Buffer.byteLength(s.text ?? "", "utf8") === 0) {
      throw new PersonaError("INVALID_PARAMS", "snippet text must not be empty");
    }
    if (Buffer.byteLength(s.text, "utf8") > MAX_SNIPPET_BYTES) {
      throw new PersonaError(
        "INVALID_PARAMS",
        `snippet text exceeds ${MAX_SNIPPET_BYTES} bytes`,
      );
    }
    // shared "/" picker namespace: no snippet/persona name collisions (D5)
    if (this.personasSeeded().some((p) => p.name === s.name)) {
      throw new PersonaError(
        "INVALID_PARAMS",
        `name collides with a persona: ${s.name}`,
      );
    }
    const all = this.snippets();
    const exists = all.some((x) => x.name === s.name);
    this.save({
      snippets: exists
        ? all.map((x) => (x.name === s.name ? s : x))
        : [...all, s],
    });
    return s;
  }

  deleteSnippet(name: string): boolean {
    const all = this.snippets();
    if (!all.some((s) => s.name === name)) return false;
    this.save({ snippets: all.filter((s) => s.name !== name) });
    return true;
  }
}
