// feature 013: structural types for the devkit Updater surface we use.
// LocalUpdateInfo/UpdateInfo aren't re-exported through the public
// entries, so we declare the consumed shape here — UpdateService takes
// an injectable UpdaterLike, which the real `Updater` singleton satisfies.
import type { UpdateStatusEntry } from "electrobun/main/updater";

export interface LocalUpdateInfo {
  version: string;
  hash: string;
  baseUrl: string;
  channel: string;
  name: string;
  displayName?: string;
  identifier: string;
}

export interface UpdateInfo {
  version: string;
  hash: string;
  updateAvailable: boolean;
  updateReady: boolean;
  error: string;
}

export interface UpdaterLike {
  getLocalInfo(): Promise<LocalUpdateInfo>;
  checkForUpdate(): Promise<UpdateInfo>;
  downloadUpdate(): Promise<void>;
  applyUpdate(): Promise<void>;
  updateInfo(): UpdateInfo;
  onStatusChange(cb: ((entry: UpdateStatusEntry) => void) | null): void;
}

// the slice of UpdateService the RPC layer consumes — tests inject stubs
import type { UpdateChannel, UpdateView } from "../../shared/types";

export interface UpdateServiceLike {
  check(manual?: boolean): Promise<UpdateView>;
  download(): Promise<{ installerPath?: string }>;
  apply(): Promise<void>;
  state(): UpdateView;
  preferredChannel(): UpdateChannel;
  installedChannel(): string;
  updatesEnabled(): boolean;
}
