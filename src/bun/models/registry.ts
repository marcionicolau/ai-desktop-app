// ModelRegistry: path-deduped map of loaded model slots (research D1).
// Two roles bound to the same file share one slot (FR-011); MAX_SLOTS
// bounds resident models and LRU-evicts non-busy slots. Slots pin while a
// turn is in flight (busyFor); a slot rebound mid-flight is marked stale
// and freed on release (D9).
import { basename } from "node:path";
import { EngineError, LlamaEngine } from "../llama/engine";
import type { EngineLike } from "../rpc/handlers";

// minimal engine surface a slot needs; LlamaEngine satisfies this and
// tests substitute fakes (native shim never loads in unit tests)
export type SlotEngine = EngineLike & { dispose(): void };

export interface ModelSlot {
  path: string;
  fileName: string;
  engine: SlotEngine;
  busyFor: string | null; // conversationId while a turn holds the slot
  stale: boolean; // rebound mid-flight — free on release
  lastUsedAt: number;
}

const DEFAULT_MAX_SLOTS = 2;

export class ModelRegistry {
  private slots = new Map<string, ModelSlot>();

  constructor(
    private maxSlots = DEFAULT_MAX_SLOTS,
    private factory: () => SlotEngine = () => new LlamaEngine(),
  ) {}

  size(): number {
    return this.slots.size;
  }

  slotFor(path: string): ModelSlot | null {
    return this.slots.get(path) ?? null;
  }

  all(): ModelSlot[] {
    return [...this.slots.values()];
  }

  anyGenerating(): boolean {
    return this.all().some((s) => s.engine.isGenerating());
  }

  stopAll(): void {
    for (const s of this.slots.values()) {
      if (s.engine.isGenerating()) s.engine.stop();
    }
  }

  // Acquire (or share) the slot for a path. Evicts the least-recently-used
  // non-busy slot when at capacity.
  async acquire(path: string): Promise<ModelSlot> {
    const existing = this.slots.get(path);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing;
    }
    if (this.slots.size >= this.maxSlots) {
      const victim = this.all()
        .filter((s) => s.busyFor === null && !s.engine.isGenerating())
        .toSorted((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
      if (!victim) {
        throw new EngineError(
          "ENGINE_BUSY",
          `all ${this.maxSlots} model slots are in use`,
        );
      }
      this.evict(victim.path);
    }
    const engine = this.factory();
    try {
      await engine.loadModel(path);
    } catch (e) {
      engine.dispose();
      throw e;
    }
    const slot: ModelSlot = {
      path,
      fileName: basename(path),
      engine,
      busyFor: null,
      stale: false,
      lastUsedAt: Date.now(),
    };
    this.slots.set(path, slot);
    return slot;
  }

  // Pin a slot to a turn; release clears the pin and frees stale slots.
  pin(path: string, conversationId: string): void {
    const s = this.slots.get(path);
    if (s) s.busyFor = conversationId;
  }

  release(path: string): void {
    const s = this.slots.get(path);
    if (!s) return;
    s.busyFor = null;
    if (s.stale) this.evict(path);
  }

  markStale(path: string): void {
    const s = this.slots.get(path);
    if (s) s.stale = true;
  }

  evict(path: string): void {
    const s = this.slots.get(path);
    if (!s) return;
    s.engine.unloadModel();
    s.engine.dispose();
    this.slots.delete(path);
  }

  shutdown(): void {
    for (const path of [...this.slots.keys()]) this.evict(path);
  }
}

// EngineLike-compatible facade: forwards to the slot for the currently
// active single-mode path (the `default` role's binding). Keeps the
// existing model.* handler surface working unchanged over the registry.
export interface RegistryEngineDeps {
  registry: ModelRegistry;
  activePath: () => string | null;
}

export function createRegistryEngine(deps: RegistryEngineDeps) {
  const active = () => {
    const p = deps.activePath();
    return p ? deps.registry.slotFor(p) : null;
  };
  return {
    status: () => {
      const s = active();
      return s
        ? { status: "ready" as const, name: s.fileName }
        : { status: "unloaded" as const };
    },
    loadModel: async (path: string) => {
      const slot = await deps.registry.acquire(path);
      return { status: "ready" as const, name: slot.fileName };
    },
    unloadModel: () => {
      const p = deps.activePath();
      if (p) deps.registry.evict(p);
    },
    isGenerating: () => deps.registry.anyGenerating(),
    stop: () => deps.registry.stopAll(),
    contextSize: () => active()?.engine.contextSize() ?? 0,
    chatTemplate: () => active()?.engine.chatTemplate() ?? null,
    tokenCount: (text: string) => active()?.engine.tokenCount(text) ?? Math.ceil(text.length / 4),
    generate: (
      prompt: string,
      onToken: (delta: string) => void,
      params?: Parameters<SlotEngine["generate"]>[2],
      opts?: { conversationId?: string },
    ) => {
      const s = active();
      if (!s) throw new EngineError("NO_MODEL", "no model is loaded");
      return s.engine.generate(prompt, onToken, params, opts);
    },
  };
}
