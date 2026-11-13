// feature 023: SessionManager (research D1/D8). One backend instance
// per runtime; calls serialize through a per-runtime promise queue so
// session state never interleaves (FR-019). Owns lazy start,
// crash→restart flagging, reset, and session.state emission.
import type {
  ScriptRuntimeKind,
  SessionInfo,
  SessionStateEvent,
} from "../../shared/types";
import type {
  ScriptBackend,
  ScriptCallRequest,
  ScriptCallResult,
} from "./backend";

interface Slot {
  backend: ScriptBackend;
  tail: Promise<unknown>;
  lastState: SessionInfo["state"];
}

export class SessionManager {
  private slots = new Map<ScriptRuntimeKind, Slot>();

  constructor(
    private deps: {
      // one fresh backend instance per runtime — each owns one session
      backendFactory: () => ScriptBackend;
      emit: (e: SessionStateEvent) => void;
    },
  ) {}

  private slot(rt: ScriptRuntimeKind): Slot {
    let s = this.slots.get(rt);
    if (!s) {
      s = {
        backend: this.deps.backendFactory(),
        tail: Promise.resolve(),
        lastState: "cold",
      };
      this.slots.set(rt, s);
    }
    return s;
  }

  private sync(rt: ScriptRuntimeKind, s: Slot): SessionInfo {
    const info = s.backend.status(rt) ?? {
      state: "cold" as const,
      calls: 0,
      restartCount: 0,
    };
    if (info.state !== s.lastState) {
      s.lastState = info.state;
      this.deps.emit({
        runtime: rt,
        state: info.state,
        restartCount: info.restartCount,
      });
    }
    return info;
  }

  status(rt: ScriptRuntimeKind): SessionInfo {
    return this.sync(rt, this.slot(rt));
  }

  // serialize: one outstanding call per runtime (FR-019)
  call(
    rt: ScriptRuntimeKind,
    interpreterPath: string,
    req: ScriptCallRequest,
  ): Promise<ScriptCallResult> {
    const s = this.slot(rt);
    const run = s.tail.then(() => this.exec(rt, s, interpreterPath, req));
    s.tail = run.catch(() => {});
    return run;
  }

  private async exec(
    rt: ScriptRuntimeKind,
    s: Slot,
    interpreterPath: string,
    req: ScriptCallRequest,
  ): Promise<ScriptCallResult> {
    const before = this.sync(rt, s);
    await s.backend.ensure(rt, interpreterPath);
    this.sync(rt, s);
    try {
      const r = await s.backend.call(rt, req);
      // fresh/dead session before this call → prior state was lost
      r.sessionRestarted = before.state !== "live";
      this.sync(rt, s);
      return r;
    } catch (e) {
      this.sync(rt, s); // surfaces dead/interrupted transitions
      throw e;
    }
  }

  async reset(rt: ScriptRuntimeKind): Promise<void> {
    const s = this.slot(rt);
    await s.backend.reset(rt);
    this.sync(rt, s);
  }

  async dispose(): Promise<void> {
    for (const rt of this.slots.keys()) {
      await this.reset(rt);
    }
  }
}
