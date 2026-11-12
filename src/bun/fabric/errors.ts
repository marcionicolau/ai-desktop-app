// feature 017: located errors for pack validation and fabric execution.
// PackError mirrors spec-agents' located validation errors; FabricError
// carries the same shape for run-time failures (step/agent path in `path`).
import { EngineError } from "../llama/engine";
import type { RpcErrorCode } from "../../shared/rpc-contract";

export class PackError extends EngineError {
  readonly file?: string;
  readonly path?: string;

  constructor(
    code: RpcErrorCode,
    message: string,
    loc?: { file?: string; path?: string },
  ) {
    super(code, message);
    this.name = "PackError";
    this.file = loc?.file;
    this.path = loc?.path;
  }

  override toString(): string {
    const at = [this.file, this.path].filter(Boolean).join(":");
    return at ? `${this.code} ${at}: ${this.message}` : super.toString();
  }
}

export class FabricError extends EngineError {
  readonly path?: string;

  constructor(code: RpcErrorCode, message: string, path?: string) {
    super(code, message);
    this.name = "FabricError";
    this.path = path;
  }
}
