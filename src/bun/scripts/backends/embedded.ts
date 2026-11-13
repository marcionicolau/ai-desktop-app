// feature 023 mechanism (a): embedded backend — a Bun Worker per
// runtime that dlopens libpython / the vendored R shim. Same
// ScriptBackend contract as the subprocess backend so the benchmark
// and all callers see identical semantics (research D3, FR-022).
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ScriptRuntimeKind, SessionInfo } from "../../../shared/types";
import type {
  ScriptBackend,
  ScriptCallRequest,
  ScriptCallResult,
} from "../backend";
import { BackendUnavailable } from "../backend";
import { scriptRunsDir } from "../../store/paths";

// libpython discovery: configured path → ldconfig/common locations
export function findLibpython(): string | null {
  const cands = [
    "/lib64/libpython3.so",
    "/usr/lib64/libpython3.so",
    "/usr/lib/x86_64-linux-gnu/libpython3.so",
    "/usr/lib/libpython3.so",
    "/lib64/libpython3.14.so.1.0",
    "/lib64/libpython3.13.so.1.0",
    "/lib64/libpython3.12.so.1.0",
  ];
  return cands.find(existsSync) ?? null;
}

// vendored shim built beside the llama shim
export function findShim(): string | null {
  const plat = `${process.platform === "darwin" ? "macos" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`;
  const bases = [
    join(import.meta.dir, "../../../../native/out", plat), // unbundled
    join(process.cwd(), "native", "out", plat), // dev layout (ffi.ts precedent)
    join(import.meta.dir, "..", "native", plat), // bundled: Resources/app/bun → app/native/<plat>
  ];
  const cands = bases.flatMap((base) => [
    join(base, "libscript_shim.so"),
    join(base, "libscript_shim.dylib"),
    join(base, "script_shim.so"),
    join(base, "script_shim.dylib"),
  ]);
  return cands.find(existsSync) ?? null;
}

interface Waiter {
  resolve: (r: unknown) => void;
  reject: (e: Error) => void;
}

interface Session {
  worker: Worker;
  waiters: Map<number, Waiter>;
  initWaiter: Waiter | null;
  dead: boolean;
}

export class EmbeddedBackend implements ScriptBackend {
  readonly kind = "embedded" as const;
  private sessions = new Map<ScriptRuntimeKind, Session>();
  private info = new Map<ScriptRuntimeKind, SessionInfo>();
  private seq = 0;

  private setInfo(rt: ScriptRuntimeKind, patch: Partial<SessionInfo>): void {
    const cur = this.info.get(rt) ?? {
      state: "cold" as const,
      calls: 0,
      restartCount: 0,
    };
    this.info.set(rt, { ...cur, ...patch });
  }

  status(rt: ScriptRuntimeKind): SessionInfo | null {
    return this.info.get(rt) ?? null;
  }

  private libFor(rt: ScriptRuntimeKind): { shim: string; rtlib: string } {
    const shim = findShim();
    if (!shim) {
      throw new BackendUnavailable(
        "runtime-unavailable",
        "script_shim native library not built (bun run build:native)",
      );
    }
    // python needs libpython for the shim to dlopen(RTLD_GLOBAL); the
    // shim itself carries libR for the R side
    const rtlib = rt === "python" ? (findLibpython() ?? "") : "";
    if (rt === "python" && !rtlib) {
      throw new BackendUnavailable(
        "runtime-unavailable",
        "libpython shared library not found",
      );
    }
    return { shim, rtlib };
  }

  private drop(rt: ScriptRuntimeKind, s: Session): void {
    if (this.sessions.get(rt) === s) this.sessions.delete(rt);
    s.dead = true;
    const err = new BackendUnavailable(
      "session-dead",
      "embedded interpreter terminated — host survived, session state lost",
    );
    for (const [, w] of s.waiters) w.reject(err);
    s.waiters.clear();
    s.initWaiter?.reject(err);
    this.setInfo(rt, { state: "dead" });
  }

  async ensure(rt: ScriptRuntimeKind, _interpreterPath: string): Promise<void> {
    const cur = this.sessions.get(rt);
    if (cur && !cur.dead) return;
    if (cur) this.drop(rt, cur);
    const libs = this.libFor(rt);
    this.setInfo(rt, { state: "starting" });
    const prev = this.info.get(rt)?.restartCount ?? 0;
    const worker = new Worker(new URL("../embedded-worker.ts", import.meta.url).href);
    const session: Session = {
      worker,
      waiters: new Map(),
      initWaiter: null,
      dead: false,
    };
    const initP = new Promise<unknown>((resolve, reject) => {
      session.initWaiter = { resolve, reject };
    });
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === "init") {
        const w = session.initWaiter;
        session.initWaiter = null;
        if (m.ok) w?.resolve(m);
        else
          w?.reject(
            new BackendUnavailable("runtime-unavailable", String(m.error)),
          );
        return;
      }
      if (m.type === "call") {
        const w2 = session.waiters.get(m.resp.id);
        if (w2) {
          session.waiters.delete(m.resp.id);
          w2.resolve(m.resp);
        }
      }
    };
    worker.onerror = () => this.drop(rt, session);
    this.sessions.set(rt, session);
    worker.postMessage({
      type: "init",
      rt,
      shim: libs.shim,
      rtlib: libs.rtlib,
      resp: scriptRunsDir(),
    });
    await initP;
    this.setInfo(rt, { state: "live", restartCount: prev + 1 });
  }

  async call(
    rt: ScriptRuntimeKind,
    req: ScriptCallRequest,
  ): Promise<ScriptCallResult> {
    const s = this.sessions.get(rt);
    if (!s || s.dead) {
      throw new BackendUnavailable(
        "session-dead",
        "embedded session is not running",
      );
    }
    const id = ++this.seq;
    const started = performance.now();
    const respP = new Promise<{
      ok: boolean;
      result: string | null;
      error: string | null;
      stdout: string;
      stderr: string;
      files: string[];
    }>((resolve, reject) => {
      s.waiters.set(id, { resolve: resolve as (r: unknown) => void, reject });
    });
    const timeout = new Promise<never>((_, reject) => {
      const t = setTimeout(() => {
        s.worker.terminate();
        this.drop(rt, s);
        reject(
          new BackendUnavailable("timeout", "script timed out", {
            stdout: "",
            stderr: "",
          }),
        );
      }, req.timeoutMs);
      t.unref?.();
    });
    s.worker.postMessage({
      id,
      code: req.code,
      args: req.args,
      input: req.input ?? null,
      cwd: req.cwd,
    });
    const resp = await Promise.race([respP, timeout]);
    const info = this.info.get(rt);
    if (info) this.setInfo(rt, { calls: info.calls + 1 });
    return {
      exitStatus: resp.ok ? 0 : 1,
      stdout: resp.stdout + (resp.result ? resp.result + "\n" : ""),
      stderr: resp.stderr + (resp.error ? resp.error + "\n" : ""),
      durationMs: performance.now() - started,
      files: resp.files.filter((f) => existsSync(join(req.cwd, f))),
      sessionRestarted: false,
    };
  }

  async reset(rt: ScriptRuntimeKind): Promise<void> {
    const s = this.sessions.get(rt);
    this.sessions.delete(rt);
    if (s) {
      s.dead = true;
      s.worker.terminate();
      const err = new BackendUnavailable(
        "interrupted",
        "session reset while a call was in flight",
      );
      for (const [, w] of s.waiters) w.reject(err);
      s.waiters.clear();
    }
    this.setInfo(rt, { state: "cold" });
  }

  async dispose(): Promise<void> {
    for (const rt of this.sessions.keys()) {
      await this.reset(rt);
    }
  }
}
