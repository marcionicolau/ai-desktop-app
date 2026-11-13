// feature 022: first-run bootstrap state — initial query + live events.
import { useEffect, useState } from "react";
import { invoke, on } from "@/lib/rpc";
import type { SetupState } from "@shared/types";

const IDLE: SetupState = {
  phase: "idle",
  downloadedBytes: 0,
  totalBytes: null,
  targets: [],
};

const retry = () => void invoke("setup.retry", {}).catch(() => {});

export function useSetup() {
  const [state, setState] = useState<SetupState>(IDLE);
  useEffect(() => {
    void invoke("setup.status", {}).then(setState).catch(() => {});
    return on("setup.status", setState);
  }, []);
  return { state, retry };
}
