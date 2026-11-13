// feature 023: the ScriptBackend contract (contracts/backend.md).
// Two mechanisms satisfy it — subprocess session (Bun.spawn runner)
// and embedded FFI session (Worker + libpython/libR prototype).
// SessionManager is the only consumer; callers never see the impl.
import type {
  ScriptRuntimeKind,
  SessionInfo,
} from "../../shared/types";

export interface ScriptCallRequest {
  runId: string;
  code: string; // script source text
  args: Record<string, unknown>; // declared params → runtime variables
  input?: string; // raw text arg for paramless scripts
  cwd: string; // dataDir()/script-runs/<runId>/ — created by caller
  timeoutMs: number;
}

export interface ScriptCallResult {
  exitStatus: number | null; // null when the eval completed (no process exit)
  stdout: string;
  stderr: string;
  durationMs: number;
  files: string[]; // names produced inside cwd
  sessionRestarted: boolean; // session was (re)created for this call
}

export class BackendUnavailable extends Error {
  constructor(
    public readonly reason:
      | "runtime-unavailable"
      | "timeout"
      | "interrupted"
      | "session-dead",
    message: string,
    public readonly partial?: { stdout: string; stderr: string },
  ) {
    super(message);
    this.name = "BackendUnavailable";
  }
}

export interface ScriptBackend {
  readonly kind: "subprocess" | "embedded";
  // cold → live: start/attach the runtime session (idempotent).
  // interpreterPath is the resolved executable (runtimes.ts).
  ensure(rt: ScriptRuntimeKind, interpreterPath: string): Promise<void>;
  // serialized upstream by SessionManager — at most one outstanding
  // call per runtime reaches here. Timeout enforcement lives here.
  call(
    rt: ScriptRuntimeKind,
    req: ScriptCallRequest,
  ): Promise<ScriptCallResult>;
  // terminate the session; ensure() may start it again
  reset(rt: ScriptRuntimeKind): Promise<void>;
  status(rt: ScriptRuntimeKind): SessionInfo | null;
  // app shutdown — all sessions
  dispose(): Promise<void>;
}
