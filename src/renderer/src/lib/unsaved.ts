// feature 026 (FR-013): forms with unsaved edits register here; leaving
// (navigating away, closing an editor) asks first. Framework-free so the
// rules are unit-tested; useUnsavedGuard wires a form to it.
export function createUnsavedStore() {
  const dirty = new Map<string, string>();
  const subs = new Set<() => void>();
  const emit = () => subs.forEach((f) => f());
  return {
    set(id: string, label: string | null) {
      const had = dirty.has(id);
      if (label === null) {
        if (!dirty.delete(id)) return;
      } else {
        if (had && dirty.get(id) === label) return;
        dirty.set(id, label);
      }
      emit();
    },
    labels(): string[] {
      return [...dirty.values()];
    },
    any(): boolean {
      return dirty.size > 0;
    },
    subscribe(f: () => void) {
      subs.add(f);
      return () => void subs.delete(f);
    },
  };
}

export const unsaved = createUnsavedStore();
