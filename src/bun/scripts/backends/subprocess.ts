// feature 023 mechanism (b): supervised child-process session per
// runtime (research D2). Bun.spawn keeps a runner process alive; the
// runner's persistent namespace IS the session. Crash containment is
// structural — a fault in user code kills the child, never the host.
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { ScriptRuntimeKind, SessionInfo } from "../../../shared/types";
import type {
  ScriptBackend,
  ScriptCallRequest,
  ScriptCallResult,
} from "../backend";
import { BackendUnavailable } from "../backend";
import { scriptRunsDir } from "../../store/paths";

const RUNNERS: Record<ScriptRuntimeKind, string> = {
  python: "python_runner.py",
  r: "r_runner.R",
};

function runnerPath(rt: ScriptRuntimeKind): string {
  const name = RUNNERS[rt];
  const cands = [
    resolve(import.meta.dir, "..", "runners", name), // unbundled (tests, smoke)
    resolve(process.cwd(), "src", "bun", "scripts", "runners", name), // dev layout
    resolve(
      process.execPath,
      "..",
      "..",
      "Resources",
      "app",
      "scripts",
      "runners",
      name,
    ), // packaged layout (Resources/app/scripts/runners)
  ];
  return cands.find(existsSync) ?? cands[0]!;
}

// explicit env — never process.env wholesale (research D9)
function sessionEnv(): Record<string, string> {
  const keep = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TZ", "R_HOME", "R_LIBS", "R_LIBS_USER", "PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV", "SSL_CERT_FILE"];
  const env: Record<string, string> = {};
  for (const k of keep) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  return env;
}

const KILL_GRACE_MS = 800;

interface Waiter {
  resolve: (r: RunnerResponse) => void;
  reject: (e: Error) => void;
}

interface RunnerResponse {
  id: number;
  ok: boolean;
  result: string | null;
  error: string | null;
  stdout: string;
  stderr: string;
  files: string[];
}

interface Session {
  proc: Bun.Subprocess;
  buf: string;
  waiters: Map<number, Waiter>;
  stderrTail: string;
  dead: Promise<void>;
}

export class SubprocessBackend implements ScriptBackend {
  readonly kind = "subprocess" as const;
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

  private pump(session: Session): void {
    const proc = session.proc;
    // stdout → NDJSON responses
    (async () => {
      const dec = new TextDecoder();
      try {
        for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
          session.buf += dec.decode(chunk, { stream: true });
          let idx: number;
          while ((idx = session.buf.indexOf("\n")) >= 0) {
            const line = session.buf.slice(0, idx);
            session.buf = session.buf.slice(idx + 1);
            if (!line.trim()) continue;
            let resp: RunnerResponse;
            try {
              resp = JSON.parse(line) as RunnerResponse;
            } catch {
              continue; // stray stdout from the interpreter — ignore
            }
            const w = session.waiters.get(resp.id);
            if (w) {
              session.waiters.delete(resp.id);
              w.resolve(resp);
            }
          }
        }
      } catch {
        /* stream ended */
      }
    })();
    // stderr → diagnostic tail (runner errors, not script stderr)
    (async () => {
      const dec = new TextDecoder();
      try {
        for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
          session.stderrTail =
            (session.stderrTail + dec.decode(chunk, { stream: true })).slice(
              -4000,
            );
        }
      } catch {
        /* stream ended */
      }
    })();
  }

  private killSession(s: Session, signal: number): void {
    try {
      s.proc.kill(signal);
    } catch {
      /* already gone */
    }
  }

  private drop(rt: ScriptRuntimeKind, s: Session): void {
    if (this.sessions.get(rt) === s) this.sessions.delete(rt);
    const err = new BackendUnavailable(
      "session-dead",
      s.stderrTail.trim() || "script session terminated",
      { stdout: "", stderr: s.stderrTail },
    );
    for (const [, w] of s.waiters) w.reject(err);
    s.waiters.clear();
    this.setInfo(rt, { state: "dead" });
  }

  async ensure(rt: ScriptRuntimeKind, interpreterPath: string): Promise<void> {
    const cur = this.sessions.get(rt);
    if (cur && cur.proc.exitCode === null) return;
    if (cur) this.drop(rt, cur);
    this.setInfo(rt, { state: "starting" });
    const prev = this.info.get(rt)?.restartCount ?? 0;
    const proc = Bun.spawn([interpreterPath, runnerPath(rt)], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: sessionEnv(),
      cwd: scriptRunsDir(),
    });
    const session: Session = {
      proc,
      buf: "",
      waiters: new Map(),
      stderrTail: "",
      dead: proc.exited.then(() => this.drop(rt, session)),
    };
    // suppress unhandled-rejection noise on the lifecycle promise
    session.dead.catch(() => {});
    this.sessions.set(rt, session);
    this.pump(session);
    this.setInfo(rt, {
      state: "live",
      restartCount: cur || prev > 0 ? prev + 1 : prev,
    });
  }

  async call(
    rt: ScriptRuntimeKind,
    req: ScriptCallRequest,
  ): Promise<ScriptCallResult> {
    const session = this.sessions.get(rt);
    if (!session || session.proc.exitCode !== null) {
      throw new BackendUnavailable(
        "session-dead",
        "script session is not running",
      );
    }
    const id = ++this.seq;
    const started = performance.now();
    const line =
      JSON.stringify({
        id,
        code: req.code,
        args: req.args,
        input: req.input ?? null,
        cwd: req.cwd,
      }) + "\n";

    const respP = new Promise<RunnerResponse>((resolve, reject) => {
      session.waiters.set(id, { resolve, reject });
    });
    session.proc.stdin.write(line);
    session.proc.stdin.flush();

    const timeout = new Promise<never>((_, reject) => {
      const t = setTimeout(() => {
        this.killSession(session, 15);
        setTimeout(() => {
          if (session.proc.exitCode === null) {
            this.killSession(session, 9);
          }
        }, KILL_GRACE_MS).unref?.();
        reject(
          new BackendUnavailable("timeout", `script timed out`, {
            stdout: "",
            stderr: session.stderrTail,
          }),
        );
      }, req.timeoutMs);
      t.unref?.();
    });

    let resp: RunnerResponse;
    try {
      resp = await Promise.race([respP, timeout]);
    } catch (e) {
      session.waiters.delete(id);
      throw e;
    }
    const durationMs = performance.now() - started;
    const info = this.info.get(rt);
    if (info) this.setInfo(rt, { calls: info.calls + 1 });

    return {
      exitStatus: resp.ok ? 0 : 1,
      stdout: resp.stdout + (resp.result ? resp.result + "\n" : "") || "",
      stderr: resp.stderr + (resp.error ? resp.error + "\n" : ""),
      durationMs,
      files: resp.files.filter((f) => existsSyncSafe(req.cwd, f)),
      sessionRestarted: false,
    };
  }

  async reset(rt: ScriptRuntimeKind): Promise<void> {
    const s = this.sessions.get(rt);
    this.sessions.delete(rt);
    if (s) {
      this.killSession(s, 9);
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

  // files produced inside the run's workdir — verified on disk
  producedFiles(cwd: string): string[] {
    try {
      return readdirSync(cwd).filter(
        (f) => existsSync(resolve(cwd, f)),
      );
    } catch {
      return [];
    }
  }
}

function existsSyncSafe(cwd: string, f: string): boolean {
  try {
    return existsSync(resolve(cwd, f));
  } catch {
    return false;
  }
}
