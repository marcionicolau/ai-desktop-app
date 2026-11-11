// feature 016: session-scoped ring of model-call metrics (FR-007).
// In-memory only — nothing persisted; capped, oldest dropped.
import { randomUUID } from "node:crypto";
import type { MetricEntry } from "../../shared/types";

const MAX_ENTRIES = 500;

export class MetricsStore {
  private entries: MetricEntry[] = [];

  record(e: Omit<MetricEntry, "id" | "ts"> & { ts?: string }): MetricEntry {
    const entry: MetricEntry = {
      ...e,
      id: randomUUID(),
      ts: e.ts ?? new Date().toISOString(),
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    return entry;
  }

  list(): MetricEntry[] {
    return [...this.entries];
  }

  clear(): { removed: number } {
    const removed = this.entries.length;
    this.entries = [];
    return { removed };
  }
}
