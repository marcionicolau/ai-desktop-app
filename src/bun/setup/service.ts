// feature 022: first-run model bootstrap (issue #28). Each semantic role
// provisions its own GGUF: roles that are unbound or bound to a missing
// file get their canonical model downloaded and bound; roles already
// bound to an existing file are left alone (user config wins).
// Single-flight and idempotent — run() is safe to call on every startup
// and via setup.retry.
//
// Deps are injected so headless tests drive every phase with fakes.
import type { DownloadState, SetupState, SetupTarget } from "../../shared/types";

// One canonical GGUF per provisioned role (litellm-style: code knows the
// aliases, models are swappable). URLs must satisfy the HF allowlist in
// models/download.ts; fileName must be the remote basename so scanModels
// picks the file up after it lands.
export interface ProvisionModel {
  role: string;
  url: string;
  fileName: string;
}

export const PROVISION_MODELS: ProvisionModel[] = [
  {
    role: "default",
    url: "https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q5_K_M.gguf",
    fileName: "Meta-Llama-3.1-8B-Instruct-Q5_K_M.gguf",
  },
  {
    role: "planner",
    url: "https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf",
    fileName: "Qwen2.5-0.5B-Instruct-Q4_K_M.gguf",
  },
  {
    role: "executor",
    url: "https://huggingface.co/bartowski/SmolLM2-360M-Instruct-GGUF/resolve/main/SmolLM2-360M-Instruct-Q4_K_M.gguf",
    fileName: "SmolLM2-360M-Instruct-Q4_K_M.gguf",
  },
];

export const PROVISION_ROLES = PROVISION_MODELS.map((m) => m.role);

// the model bound to "default"; binding it syncs activeModelPath,
// which is what deps.load() then loads
export const DEFAULT_MODEL = PROVISION_MODELS[0]!;

export interface SetupDeps {
  // true when the role needs no provisioning — bound to a file that
  // exists (a user-configured binding is never overridden)
  roleReady(role: string): boolean;
  // true when the file is already present in the models dir
  fileExists(fileName: string): boolean;
  // downloads m via the shared core; resolves when the file has landed
  // (renamed off .part), rejects on failure
  download(m: ProvisionModel, onEvent: (s: DownloadState) => void): Promise<void>;
  // binds the landed file to a provisioned role, creating the tag when
  // missing; "default" also syncs activeModelPath
  bindRole(role: string, fileName: string): void;
  // normal load path (emits model.progress loading/ready/error)
  load(): Promise<void>;
  emit(state: SetupState): void;
}

export class SetupService {
  private state: SetupState = {
    phase: "idle",
    downloadedBytes: 0,
    totalBytes: null,
    targets: [],
  };
  private inflight: Promise<void> | null = null;
  private userDownloads = 0;

  constructor(private deps: SetupDeps) {}

  status(): SetupState {
    return { ...this.state, targets: this.state.targets.map((t) => ({ ...t })) };
  }

  // FR-007 busy guard; callers may repeat the inactive edge — the
  // counter is floored at zero so double-ends can't corrupt it
  noteUserDownload(active: boolean): void {
    this.userDownloads = Math.max(0, this.userDownloads + (active ? 1 : -1));
  }

  run(): Promise<void> {
    this.inflight ??= this.exec().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private set(next: Partial<SetupState>): void {
    this.state = {
      ...this.state,
      downloadedBytes: 0,
      totalBytes: null,
      ...next,
    };
    this.deps.emit(this.status());
  }

  private setTarget(role: string, status: SetupTarget["status"]): void {
    this.set({
      targets: this.state.targets.map((t) =>
        t.role === role ? { ...t, status } : t,
      ),
    });
  }

  private fail(e: unknown): void {
    this.set({
      phase: "error",
      error: e instanceof Error ? e.message : String(e),
      targets: this.state.targets.map((t) =>
        t.status === "done" ? t : { ...t, status: "error" as const },
      ),
    });
  }

  private async exec(): Promise<void> {
    if (this.userDownloads > 0) return; // stay idle; manual path wins
    this.set({ phase: "checking", error: undefined });
    // provision only what isn't already bound to a real file — a partial
    // or user-customized setup never gets re-downloaded or re-bound
    const pending = PROVISION_MODELS.filter(
      (m) => !this.deps.roleReady(m.role),
    );
    if (pending.length === 0) {
      this.set({ phase: "done" });
      return;
    }
    this.set({
      phase: "downloading",
      targets: pending.map((m) => ({
        role: m.role,
        fileName: m.fileName,
        status: "pending" as const,
        downloadedBytes: 0,
        totalBytes: null,
      })),
    });
    try {
      for (const m of pending) {
        if (this.deps.fileExists(m.fileName)) continue;
        this.setTarget(m.role, "downloading");
        this.set({ fileName: m.fileName });
        // oxlint-disable-next-line no-await-in-loop -- sequential per-file download keeps progress truthful
        await this.deps.download(m, (s) => {
          if (s.phase === "progress") {
            this.set({
              fileName: s.fileName,
              downloadedBytes: s.downloadedBytes,
              totalBytes: s.totalBytes,
              targets: this.state.targets.map((t) =>
                t.fileName === s.fileName
                  ? {
                      ...t,
                      downloadedBytes: s.downloadedBytes,
                      totalBytes: s.totalBytes,
                    }
                  : t,
              ),
            });
          }
        });
      }
    } catch (e) {
      this.fail(e);
      return;
    }
    this.set({ phase: "loading" });
    try {
      for (const m of pending) {
        this.setTarget(m.role, "loading");
        this.deps.bindRole(m.role, m.fileName);
        this.setTarget(m.role, "done");
      }
      await this.deps.load();
    } catch (e) {
      this.fail(e);
      return;
    }
    this.set({ phase: "done" });
  }
}
