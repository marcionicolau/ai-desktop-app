// Typed engine wrapper over the llama_shim FFI surface.
// Pull model: generate() drives an async lls_step loop on the JS thread,
// yielding to the event loop between steps so RPC stays responsive.
import { accessSync, constants, existsSync } from "node:fs";
import { ptr } from "bun:ffi";
import { basename } from "node:path";
import type { RpcErrorCode } from "../../shared/rpc-contract";
import type { GenerationParams } from "../../shared/types";
import { loadLlamaShim, newErrSlot, readErr, type LlamaShim } from "./ffi";
import { packParams } from "./params";

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
  private model: number | null = null;
  private ctx: number | null = null;
  private modelName: string | null = null;
  private generating = false;
  private stopRequested = false;
  private kvConvId: string | null = null;
  private tokenBuf = new Uint8Array(TOKEN_BUF_CAP);
  private outLen = new BigUint64Array(1);

  status(): { status: "unloaded" | "loading" | "ready" | "error"; name?: string; error?: string } {
    if (this.model !== null) {
      return { status: "ready", name: this.modelName ?? undefined };
    }
    return { status: "unloaded" };
  }

  async loadModel(path: string): Promise<{ status: "ready"; name: string }> {
    if (!existsSync(path)) {
      throw new EngineError("MODEL_NOT_FOUND", `model file not found: ${path}`);
    }
    try {
      accessSync(path, constants.R_OK);
    } catch {
      throw new EngineError("MODEL_INVALID", `model file is not readable: ${path}`);
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
    if (!model) {
      const msg = readErr(this.shim, err) ?? "failed to load model";
      throw new EngineError(
        /memory|alloc/i.test(msg) ? "OUT_OF_MEMORY" : "MODEL_INVALID",
        msg,
      );
    }

    const ctx = symbols.lls_ctx_create(model, ptr(err));
    if (!ctx) {
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
    if (this.ctx !== null) {
      this.shim.symbols.lls_generate_end(this.ctx);
      this.shim.symbols.lls_ctx_free(this.ctx);
      this.ctx = null;
    }
    if (this.model !== null) {
      this.shim.symbols.lls_model_free(this.model);
      this.model = null;
    }
    this.modelName = null;
    this.generating = false;
    this.stopRequested = false;
    this.kvConvId = null;
  }

  stop(): void {
    this.stopRequested = true;
  }

  isGenerating(): boolean {
    return this.generating;
  }

  // configured context-window size in tokens; 0 when no model is loaded
  contextSize(): number {
    if (this.ctx === null || this.shim === null) return 0;
    return this.shim.symbols.lls_ctx_size(this.ctx);
  }

  chatTemplate(): string | null {
    if (this.model === null || this.shim === null) return null;
    return this.shim.symbols.lls_chat_template(this.model);
  }

  // real token count via the model's tokenizer; chars/4 estimate when no
  // model is loaded (fallback keeps budgeting sane pre-load)
  tokenCount(text: string): number {
    if (this.ctx === null || this.shim === null) {
      return Math.ceil(text.length / 4);
    }
    const n = this.shim.symbols.lls_token_count(this.ctx, text);
    return n > 0 ? n : Math.ceil(text.length / 4);
  }

  // Drives the pull loop. onToken receives raw byte-chunks decoded as text.
  // params == null selects shim defaults (greedy + LLS_MAX_GEN/512 cap).
  // Resolves status "complete" on natural end, "partial" when stop() was
  // called; tokens counts generated tokens (one per lls_step).
  async generate(
    prompt: string,
    onToken: (delta: string) => void,
    params?: GenerationParams | null,
    opts?: { conversationId?: string },
  ): Promise<{
    status: "complete" | "partial";
    tokens: number;
    elapsedMs: number;
    warm: boolean;
  }> {
    if (this.ctx === null || this.shim === null) {
      throw new EngineError("NO_MODEL", "no model is loaded");
    }
    if (this.generating) {
      throw new EngineError("ENGINE_BUSY", "a generation is already active");
    }
    const { symbols } = this.shim;
    const err = newErrSlot();
    const pbuf = params ? packParams(params) : null;

    // KV reuse: continue-path when the conversation matches the last one;
    // the shim verifies the token prefix and falls back to a full decode
    // on any mismatch (correctness is guaranteed in C)
    const convId = opts?.conversationId;
    const resume = convId !== undefined && convId === this.kvConvId;
    const pptr = pbuf ? ptr(pbuf) : null;
    const rc = resume
      ? symbols.lls_generate_continue(this.ctx, prompt, pptr, ptr(err))
      : symbols.lls_generate_begin(this.ctx, prompt, pptr, ptr(err));
    if (rc !== 0 && rc !== 2) {
      const msg = readErr(this.shim, err) ?? "failed to begin generation";
      throw new EngineError("ENGINE_ERROR", msg);
    }
    const warm = resume && rc === 0;
    this.kvConvId = convId ?? this.kvConvId;

    const started = performance.now();
    let tokens = 0;
    this.generating = true;
    this.stopRequested = false;
    try {
      for (;;) {
        if (this.stopRequested) {
          return {
            status: "partial",
            tokens,
            elapsedMs: performance.now() - started,
            warm,
          };
        }
        this.outLen[0] = 0n;
        const r = symbols.lls_step(this.ctx, ptr(this.tokenBuf), TOKEN_BUF_CAP, ptr(this.outLen));
        if (r === 0) {
          return {
            status: "complete",
            tokens,
            elapsedMs: performance.now() - started,
            warm,
          };
        }
        if (r < 0) {
          throw new EngineError("ENGINE_ERROR", "decode step failed");
        }
        tokens += 1;
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
