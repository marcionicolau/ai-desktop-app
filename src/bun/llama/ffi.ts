// FFI loader for libllama_shim. Symbol surface and ownership rules are
// defined in specs/001-desktop-ai-chat/contracts/ffi.md.
import { CString, FFIType, dlopen, ptr, read } from "bun:ffi";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const LIB_BASENAME = "llama_shim";

function platformDir(): string {
  const os =
    process.platform === "win32"
      ? "win"
      : process.platform === "darwin"
        ? "darwin"
        : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `${os}-${arch}`;
}

function libSuffix(): string {
  if (process.platform === "win32") return ".dll";
  if (process.platform === "darwin") return ".dylib";
  return ".so";
}

function candidates(): string[] {
  const name = `lib${LIB_BASENAME}${libSuffix()}`;
  const plat = platformDir();
  const list: string[] = [];
  if (process.env.LLAMA_NATIVE_DIR) {
    list.push(join(process.env.LLAMA_NATIVE_DIR, name));
  }
  // dev layout: native/out/<platform>/ relative to repo root
  list.push(resolve(process.cwd(), "native", "out", plat, name));
  // packaged layout: <exe>/../Resources/app/native/<platform>/
  list.push(resolve(process.execPath, "..", "..", "Resources", "app", "native", plat, name));
  return list;
}

export interface LlamaShimSymbols {
  lls_version(): string;
  lls_model_load(path: string, err: number): number;
  lls_model_free(model: number): void;
  lls_ctx_create(model: number, err: number): number;
  lls_ctx_free(ctx: number): void;
  lls_ctx_size(ctx: number): number;
  lls_chat_template(model: number): string | null;
  lls_generate_begin(ctx: number, prompt: string, err: number): number;
  lls_step(ctx: number, buf: number, cap: number | bigint, outLen: number): number;
  lls_generate_end(ctx: number): void;
  lls_free_string(s: number): void;
}

export type LlamaShim = ReturnType<typeof loadLlamaShim>;

export function loadLlamaShim() {
  const tried = candidates();
  const libPath = tried.find((p) => existsSync(p));
  if (!libPath) {
    throw new Error(`llama_shim not found. Tried:\n  ${tried.join("\n  ")}`);
  }

  const lib = dlopen(libPath, {
    lls_version: { args: [], returns: FFIType.cstring },
    lls_model_load: { args: [FFIType.cstring, FFIType.ptr], returns: FFIType.ptr },
    lls_model_free: { args: [FFIType.ptr], returns: FFIType.void },
    lls_ctx_create: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    lls_ctx_free: { args: [FFIType.ptr], returns: FFIType.void },
    lls_ctx_size: { args: [FFIType.ptr], returns: FFIType.i32 },
    lls_chat_template: { args: [FFIType.ptr], returns: FFIType.cstring },
    lls_generate_begin: {
      args: [FFIType.ptr, FFIType.cstring, FFIType.ptr],
      returns: FFIType.i32,
    },
    lls_step: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr],
      returns: FFIType.i32,
    },
    lls_generate_end: { args: [FFIType.ptr], returns: FFIType.void },
    lls_free_string: { args: [FFIType.ptr], returns: FFIType.void },
  });

  return { lib, path: libPath, symbols: lib.symbols as unknown as LlamaShimSymbols };
}

// char** err out-param: allocate a pointer-sized slot, pass its address,
// then read + free whatever the shim stored there.
export function newErrSlot(): BigUint64Array {
  return new BigUint64Array(1);
}

export function readErr(lib: LlamaShim, slot: BigUint64Array): string | null {
  const addr = read.ptr(ptr(slot));
  if (addr === 0) return null;
  const msg = new CString(addr).toString();
  lib.symbols.lls_free_string(addr);
  return msg;
}
