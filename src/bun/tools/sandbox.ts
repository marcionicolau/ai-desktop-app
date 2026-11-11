// feature 015: sandbox containment (research D4). The root is
// canonicalized once; every requested path resolves against it and must
// survive a realpath check before any I/O — `..` traversal and symlink
// escapes resolve out and are refused.
import { realpathSync } from "node:fs";
import { isAbsolute, join, resolve as resolvePath, sep } from "node:path";

export type SandboxResolution =
  | { ok: true; resolved: string }
  | { ok: false; reason: "out-of-sandbox" | "missing"; path: string };

export class Sandbox {
  readonly root: string;

  constructor(root: string) {
    // canonical once — throws if the configured root doesn't exist
    this.root = realpathSync(root);
  }

  private inside(p: string): boolean {
    return p === this.root || p.startsWith(this.root + sep);
  }

  // relative paths join the root; absolute paths are taken as-is but
  // still must land inside. `resolve` collapses `..` before the check.
  resolve(requested: string): SandboxResolution {
    const candidate = isAbsolute(requested)
      ? resolvePath(requested)
      : resolvePath(join(this.root, requested));
    // lexical containment first (cheap, covers nonexistent targets)
    if (!this.inside(candidate)) {
      return { ok: false, reason: "out-of-sandbox", path: requested };
    }
    let real: string;
    try {
      real = realpathSync(candidate);
    } catch {
      // in-root but doesn't exist — a tool error, not a refusal
      return { ok: false, reason: "missing", path: requested };
    }
    // realpath check defeats symlink escapes
    if (!this.inside(real)) {
      return { ok: false, reason: "out-of-sandbox", path: requested };
    }
    return { ok: true, resolved: real };
  }
}
