// feature 013: UpdateService — orchestrates the devkit Updater behind a
// single UpdateView. Same-channel updates use the full devkit pipeline
// (check → verified download → native apply); the preferred channel may
// differ from installed, in which case downloads become a guided
// installer fetch (research.md D4). All network I/O is the release feed
// only (FR-010); disabled → zero requests.
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import type { Settings, UpdateChannel, UpdateView } from "../../shared/types";
import { checkChannelFeed } from "./feed";
import { reduceEntry } from "./status-map";
import type { LocalUpdateInfo, UpdaterLike } from "./types-internal";

const UPDATE_OFF = () => process.env.AI_DESKTOP_APP_UPDATE === "off";

export interface UpdateServiceDeps {
  updater: UpdaterLike;
  getSettings: () => Settings;
  emit: (method: "update.status", payload: UpdateView) => void;
  fetchImpl?: typeof fetch;
  downloadsDir?: string;
  platform?: { os: "linux" | "macos" | "win"; arch: "x64" | "arm64" };
  now?: () => number;
}

export class UpdateError extends Error {
  constructor(
    public code: "UPDATE_INVALID" | "UPDATE_FAILED" | "UPDATE_DISABLED",
    message: string,
  ) {
    super(message);
  }
}

const PLATFORM = {
  os:
    process.platform === "darwin"
      ? ("macos" as const)
      : process.platform === "win32"
        ? ("win" as const)
        : ("linux" as const),
  arch:
    process.arch === "arm64" ? ("arm64" as const) : ("x64" as const),
};

export class UpdateService {
  private view: UpdateView;
  private infoPromise: Promise<LocalUpdateInfo> | null = null;
  private checking = false;

  constructor(private deps: UpdateServiceDeps) {
    this.view = {
      status: "idle",
      current: { version: "0.0.0", channel: "dev" },
      preferredChannel: "canary",
    };
    // resolve the installed identity once so sync accessors (settings
    // defaults, channel display) work before the first check
    void this.info()
      .then((info) => {
        this.view.current = { version: info.version, channel: info.channel };
        this.view.preferredChannel = this.preferred(info.channel);
      })
      .catch(() => {});
    deps.updater.onStatusChange((entry) => {
      const r = reduceEntry(entry);
      if (r.status === "idle" && !r.errorCode) return;
      this.view = {
        ...this.view,
        status: r.status === "idle" ? this.view.status : r.status,
        progress:
          r.status === "downloading"
            ? (r.progress ?? this.view.progress)
            : undefined,
        error: r.errorCode
          ? { code: r.errorCode, message: r.message ?? "update failed" }
          : undefined,
      };
      this.push();
    });
  }

  private push() {
    this.deps.emit("update.status", this.snapshot());
  }

  private snapshot(): UpdateView {
    return structuredClone(this.view);
  }

  private async info(): Promise<LocalUpdateInfo> {
    this.infoPromise ??= this.deps.updater.getLocalInfo();
    return this.infoPromise;
  }

  private enabled(): boolean {
    if (UPDATE_OFF()) return false;
    return this.deps.getSettings().updates?.enabled !== false;
  }

  private preferred(installed: string): UpdateChannel {
    const c = this.deps.getSettings().updates?.channel;
    return c === "stable" || c === "canary"
      ? c
      : installed === "stable"
        ? "stable"
        : "canary";
  }

  // sync accessor for settings.get — installed channel once resolved,
  // else the settings override, else canary (dev builds are disabled anyway)
  preferredChannel(): UpdateChannel {
    return this.view.preferredChannel;
  }

  installedChannel(): string {
    return this.view.current.channel;
  }

  updatesEnabled(): boolean {
    return this.enabled();
  }

  async check(manual = false): Promise<UpdateView> {
    const info = await this.info();
    this.view.current = { version: info.version, channel: info.channel };
    this.view.preferredChannel = this.preferred(info.channel);

    const disabled =
      !this.enabled() || info.channel === "dev" || info.channel === "";
    if (disabled) {
      if (manual)
        throw new UpdateError(
          "UPDATE_DISABLED",
          info.channel === "dev"
            ? "Updates are disabled on dev builds"
            : "Updates are disabled in settings",
        );
      return this.snapshot();
    }

    if (this.checking) return this.snapshot();
    this.checking = true;
    this.view = { ...this.view, status: "checking", error: undefined };
    this.push();
    try {
      const release = await checkChannelFeed(
        info,
        this.view.preferredChannel,
        (this.deps.platform ?? PLATFORM).os,
        (this.deps.platform ?? PLATFORM).arch,
        { fetchImpl: this.deps.fetchImpl },
      );
      this.view.lastCheckedAt = (this.deps.now ?? Date.now)();
      if (!release) {
        this.view = {
          ...this.view,
          status: "idle",
          release: undefined,
          channelSwitch: undefined,
        };
      } else if (this.view.preferredChannel === info.channel) {
        // same channel → populate the devkit's private manifest so
        // downloadUpdate/applyUpdate can take over
        const ui = await this.deps.updater.checkForUpdate();
        this.view = {
          ...this.view,
          status: ui.updateAvailable ? "available" : "idle",
          release: ui.updateAvailable ? release : undefined,
          channelSwitch: undefined,
        };
      } else {
        this.view = {
          ...this.view,
          status: "available",
          release,
          channelSwitch: true,
        };
      }
    } catch (e) {
      // launch-mode failures degrade silently (FR-007); manual surfaces
      this.view = { ...this.view, status: "idle" };
      if (manual) {
        throw e instanceof UpdateError
          ? e
          : new UpdateError(
              "UPDATE_FAILED",
              `Update check failed: ${(e as Error).message}`,
            );
      }
    } finally {
      this.checking = false;
      this.push();
    }
    return this.snapshot();
  }

  async download(): Promise<{ installerPath?: string }> {
    if (!this.enabled()) throw new UpdateError("UPDATE_DISABLED", "Updates are disabled");
    if (this.view.status !== "available" || !this.view.release) return {};
    const info = await this.info();

    if (this.view.channelSwitch) {
      // cross-channel: the update tar isn't an installer — fetch the
      // packaged zip from the versioned tag release (contracts/feed.md)
      const rel = this.view.release;
      const p = this.deps.platform ?? PLATFORM;
      const installerName = `ai-desktop-app-${rel.channel}-${p.os}-${p.arch}.zip`;
      const ghFeed = info.baseUrl.match(/^(.*)\/releases\/download\/[^/]+$/);
      const url = ghFeed
        ? `${ghFeed[1]}/releases/download/v${rel.version}/${installerName}`
        : `${info.baseUrl.replace(/\/+$/, "")}/${installerName}`;
      const res = await (this.deps.fetchImpl ?? fetch)(url, {
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok)
        throw new UpdateError(
          "UPDATE_FAILED",
          `Installer download failed: HTTP ${res.status}`,
        );
      const dir =
        this.deps.downloadsDir ?? join(homedir(), "Downloads");
      mkdirSync(dir, { recursive: true });
      const installerPath = join(dir, installerName);
      writeFileSync(installerPath, new Uint8Array(await res.arrayBuffer()));
      return { installerPath };
    }

    await this.deps.updater.downloadUpdate();
    return {};
  }

  async apply(): Promise<void> {
    if (!this.enabled()) throw new UpdateError("UPDATE_DISABLED", "Updates are disabled");
    if (this.view.channelSwitch)
      throw new UpdateError(
        "UPDATE_FAILED",
        "Channel switch installs manually — run the downloaded installer",
      );
    const ui = this.deps.updater.updateInfo();
    if (!ui.updateReady)
      throw new UpdateError("UPDATE_FAILED", "No staged update is ready");
    await this.deps.updater.applyUpdate();
  }

  state(): UpdateView {
    return this.snapshot();
  }
}
