// GenerationParams helpers: merge order is
//   DEFAULT_GENERATION <- settings.generation <- modelOverrides[basename]
// and packParams serializes to the lls_gen_params FFI struct layout.
import type { GenerationParams } from "../../shared/types";

export { DEFAULT_GENERATION } from "../../shared/types";
export type { GenerationParams } from "../../shared/types";

// lls_gen_params layout (little-endian, 32 bytes):
//   f32 temperature @0, f32 top_p @4, i32 top_k @8, f32 repeat_penalty @12,
//   u32 seed @16, i32 max_tokens @20, i32 n_threads @24, i32 n_gpu_layers @28
export const PARAMS_STRUCT_SIZE = 32;

export function mergeParams(
  base: GenerationParams,
  override?: Partial<GenerationParams> | null,
): GenerationParams {
  return { ...base, ...override };
}

// Returns the first validation error, or null when all fields are in range.
export function validateParams(
  p: Partial<GenerationParams>,
): string | null {
  const rules: [keyof GenerationParams, number, number][] = [
    ["temperature", 0, 2],
    ["topP", 0, 1],
    ["topK", 0, Number.MAX_SAFE_INTEGER],
    ["repeatPenalty", 0, Number.MAX_SAFE_INTEGER],
    ["seed", 0, 0xffffffff],
    ["maxTokens", 0, Number.MAX_SAFE_INTEGER],
    ["nThreads", 0, Number.MAX_SAFE_INTEGER],
    ["nGpuLayers", 0, Number.MAX_SAFE_INTEGER],
  ];
  for (const [key, min, max] of rules) {
    const v = p[key];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
      return `${key} out of range (${min}..${max})`;
    }
  }
  return null;
}

export function packParams(p: GenerationParams): Uint8Array {
  const buf = new Uint8Array(PARAMS_STRUCT_SIZE);
  const view = new DataView(buf.buffer);
  view.setFloat32(0, p.temperature, true);
  view.setFloat32(4, p.topP, true);
  view.setInt32(8, p.topK, true);
  view.setFloat32(12, p.repeatPenalty, true);
  view.setUint32(16, p.seed, true);
  view.setInt32(20, p.maxTokens, true);
  view.setInt32(24, p.nThreads, true);
  view.setInt32(28, p.nGpuLayers, true);
  return buf;
}
