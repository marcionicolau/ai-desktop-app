// feature 022: first-run model bootstrap (issue #28). When no usable
// chat model exists, download a small default GGUF through the shared
// download core, bind it to the "default" role (syncs activeModelPath),
// then trigger the normal load path. Single-flight and idempotent —
// run() is safe to call on every startup and via setup.retry.
//
// Deps are injected so headless tests drive every phase with fakes.
import type { DownloadState, SetupState, SetupTarget } from "../../shared/types";

// Small instruct quant kept to a first-run-friendly size (~400 MiB).
// Must satisfy the HF allowlist in models/download.ts; the file name
// must be the remote basename — scanModels picks it up after landing.
export const DEFAULT_MODEL = {
  url: "https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf",
  fileName: "Qwen2.5-0.5B-Instruct-Q4_K_M.gguf",
} as const;

export interface SetupDeps {
  // true when a usable chat model exists: any file in the models dir or
  // a configured activeModelPath that still resolves (spec: never
  // download over a working/user-configured setup)
  hasUsableModel(): boolean;
  // downloads DEFAULT_MODEL via the shared core; resolves when the file
  // has landed (renamed off .part), rejects on failure
  download(onEvent: (s: DownloadState) => void): Promise<void>;
  // binds the landed file to the "default" role → activeModelPath
  bindDefault(fileName: string): void;
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

  private setTarget(status: SetupTarget["status"]): void {
    this.set({
      targets: this.state.targets.map((t) =>
        t.role === "default" ? { ...t, status } : t,
      ),
    });
  }

  private fail(e: unknown): void {
    this.set({
      phase: "error",
      error: e instanceof Error ? e.message : String(e),
    });
    this.setTarget("error");
  }

  private async exec(): Promise<void> {
    if (this.userDownloads > 0) return; // stay idle; manual path wins
    this.set({ phase: "checking", error: undefined });
    if (this.deps.hasUsableModel()) {
      this.set({ phase: "done" });
      return;
    }
    this.set({
      phase: "downloading",
      fileName: DEFAULT_MODEL.fileName,
      targets: [
        {
          role: "default",
          fileName: DEFAULT_MODEL.fileName,
          status: "downloading",
          downloadedBytes: 0,
          totalBytes: null,
        },
      ],
    });
    try {
      await this.deps.download((s) => {
        if (s.phase === "progress") {
          this.set({
            fileName: s.fileName,
            downloadedBytes: s.downloadedBytes,
            totalBytes: s.totalBytes,
            targets: this.state.targets.map((t) =>
              t.role === "default"
                ? { ...t, downloadedBytes: s.downloadedBytes, totalBytes: s.totalBytes }
                : t,
            ),
          });
        }
      });
    } catch (e) {
      this.fail(e);
      return;
    }
    this.set({ phase: "loading" });
    this.setTarget("loading");
    try {
      this.deps.bindDefault(DEFAULT_MODEL.fileName);
      await this.deps.load();
    } catch (e) {
      this.fail(e);
      return;
    }
    this.setTarget("done");
    this.set({ phase: "done" });
  }
}
