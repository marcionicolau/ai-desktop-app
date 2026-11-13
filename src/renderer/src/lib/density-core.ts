// feature 026: the pure part of the density feature (no DOM, no RPC), so it
// is unit-tested without a browser. lib/density.ts wires it to the page.
import type { Density } from "../../../shared/types";

export const DENSITIES: Density[] = ["comfortable", "compact"];
export const isDensity = (v: unknown): v is Density => v === "comfortable" || v === "compact";
export const nextDensity = (d: Density): Density => (d === "compact" ? "comfortable" : "compact");
