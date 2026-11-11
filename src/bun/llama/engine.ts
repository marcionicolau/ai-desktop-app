// Typed engine wrapper over the llama_shim FFI surface.
// Pull model: generate() drives an async lls_step loop on the JS thread,
// yielding to the event loop between steps so RPC stays responsive.
import { existsSync } from "node:fs";
import { ptr } from "bun:ffi";
import { basename } from "node:path";
import type { RpcErrorCode } from "../../shared/rpc-contract";
import { loadLlamaShim, newErrSlot, readErr, type LlamaShim } from "./ffi";

export class EngineError extends Error {
  constructor(
    public readonly code: RpcErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

const TOKEN_BUF_CAP = 4096;

export class LlamaEngine {
  private shim: LlamaShim | null = null;
  private model = 0;
  private ctx = 0;
  private modelName: string | null = null;
  private generating = false;
  private stopRequested = false;
  private tokenBuf = new Uint8Array(TOKEN_BUF_CAP);
  private outLen = new BigUint64Array(1);

  status(): { status: "unloaded" | "loading" | "ready" | "error"; name?: string; error?: string } {
    if (this.model !== 0) {
      return { status: "ready", name: this.modelName ?? undefined };
    }
    return { status: "unloaded" };
  }

  async loadModel(path: string): Promise<{ status: "ready"; name: string }> {
    if (!existsSync(path)) {
      throw new EngineError("MODEL_NOT_FOUND", `model file not found: ${path}`);
    }
    this.unloadModel();

    if (this.shim === null) {
      try {
        this.shim = loadLlamaShim();
      } catch (e) {
        throw new EngineError("ENGINE_ERROR", String(e));
      }
    }
    const { symbols } = this.shim;
    const err = newErrSlot();

    const model = symbols.lls_model_load(path, ptr(err));
    if (model === 0) {
      const msg = readErr(this.shim, err) ?? "failed to load model";
      throw new EngineError(
        /memory|alloc/i.test(msg) ? "OUT_OF_MEMORY" : "MODEL_INVALID",
        msg,
      );
    }

    const ctx = symbols.lls_ctx_create(model, ptr(err));
    if (ctx === 0) {
      const msg = readErr(this.shim, err) ?? "failed to create context";
      symbols.lls_model_free(model);
      throw new EngineError("OUT_OF_MEMORY", msg);
    }

    this.model = model;
    this.ctx = ctx;
    this.modelName = basename(path);
    return { status: "ready", name: this.modelName };
  }

  unloadModel(): void {
    // shutdown order: generate_end -> ctx_free -> model_free (lib stays open)
    if (this.shim === null) return;
    if (this.ctx !== 0) {
      this.shim.symbols.lls_generate_end(this.ctx);
      this.shim.symbols.lls_ctx_free(this.ctx);
      this.ctx = 0;
    }
    if (this.model !== 0) {
      this.shim.symbols.lls_model_free(this.model);
      this.model = 0;
    }
    this.modelName = null;
    this.generating = false;
    this.stopRequested = false;
  }

  stop(): void {
    this.stopRequested = true;
  }

  // Drives the pull loop. onToken receives raw byte-chunks decoded as text.
  // Resolves "complete" on natural end, "partial" when stop() was called.
  async generate(
    prompt: string,
    onToken: (delta: string) => void,
  ): Promise<"complete" | "partial"> {
    if (this.ctx === 0 || this.shim === null) {
      throw new EngineError("NO_MODEL", "no model is loaded");
    }
    if (this.generating) {
      throw new EngineError("ENGINE_BUSY", "a generation is already active");
    }
    const { symbols } = this.shim;
    const err = newErrSlot();

    if (symbols.lls_generate_begin(this.ctx, prompt, ptr(err)) !== 0) {
      const msg = readErr(this.shim, err) ?? "failed to begin generation";
      throw new EngineError("ENGINE_ERROR", msg);
    }

    this.generating = true;
    this.stopRequested = false;
    try {
      for (;;) {
        if (this.stopRequested) {
          return "partial";
        }
        this.outLen[0] = 0n;
        const r = symbols.lls_step(this.ctx, ptr(this.tokenBuf), TOKEN_BUF_CAP, ptr(this.outLen));
        if (r === 0) {
          return "complete";
        }
        if (r < 0) {
          throw new EngineError("ENGINE_ERROR", "decode step failed");
        }
        const n = Number(this.outLen[0]);
        if (n > 0) {
          onToken(new TextDecoder().decode(this.tokenBuf.subarray(0, n)));
        }
        // macrotask yield: keeps the event loop responsive for RPC
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      symbols.lls_generate_end(this.ctx);
      this.generating = false;
    }
  }

  dispose(): void {
    this.unloadModel();
    if (this.shim !== null) {
      this.shim.lib.close();
      this.shim = null;
    }
  }
}
