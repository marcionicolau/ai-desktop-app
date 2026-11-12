// feature 013 (US2): update preferences — enabled toggle, channel
// select, manual check, current version/channel. dev builds surface
// the disabled state (updates are a packaged-build feature).
import { useEffect, useState } from "react";
import { invoke } from "@/lib/rpc";
import { Button } from "@/components/ui/button";
import type { UpdateChannel, UpdateView } from "@shared/types";

const CHANNELS: { value: UpdateChannel; label: string }[] = [
  { value: "stable", label: "Stable" },
  { value: "canary", label: "Canary" },
];

export function UpdatesSection() {
  const [view, setView] = useState<UpdateView | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [channel, setChannel] = useState<UpdateChannel>("canary");
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void invoke("settings.get", {}).then((s) => {
      setEnabled(s.updates.enabled);
      setChannel(s.updates.channel);
    });
    void invoke("update.state", {}).then(setView).catch(() => {});
  }, []);

  const save = async (patch: { enabled?: boolean; channel?: UpdateChannel }) => {
    try {
      await invoke("settings.set", { updates: patch });
      setNote(null);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };

  const checkNow = async () => {
    setChecking(true);
    setNote(null);
    try {
      const v = await invoke("update.check", { manual: true });
      setView(v);
      if (v.status === "idle") setNote("You're up to date.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  const isDev = view?.current.channel === "dev";
  const channelDiffers =
    view != null && channel !== view.current.channel && !isDev;

  return (
    <div className="border-b border-border bg-muted/40 px-4 py-3">
      <div className="mx-auto flex max-w-2xl flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Updates</span>
          <span className="text-xs text-muted-foreground">
            v{view?.current.version ?? "…"} · {view?.current.channel ?? "…"}
            {view?.lastCheckedAt &&
              ` · checked ${new Date(view.lastCheckedAt).toLocaleTimeString()}`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={enabled}
              disabled={isDev}
              onChange={(e) => {
                setEnabled(e.target.checked);
                void save({ enabled: e.target.checked });
              }}
            />
            Automatic checks
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            Channel
            <select
              className="rounded border border-border bg-background px-1.5 py-0.5 text-xs"
              value={channel}
              disabled={isDev}
              onChange={(e) => {
                const c = e.target.value as UpdateChannel;
                setChannel(c);
                void save({ channel: c });
              }}
            >
              {CHANNELS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            variant="secondary"
            disabled={checking || !enabled || isDev}
            onClick={() => void checkNow()}
          >
            {checking ? "Checking…" : "Check for updates"}
          </Button>
        </div>
        {isDev && (
          <p className="text-xs text-muted-foreground/80">
            Updates are disabled on dev builds — they work in packaged
            canary/stable installs.
          </p>
        )}
        {channelDiffers && (
          <p className="text-xs text-muted-foreground/80">
            Selected channel differs from this install — switching installs
            the {channel} build side-by-side; your data is untouched.
          </p>
        )}
        {note && <p className="text-xs text-muted-foreground/80">{note}</p>}
      </div>
    </div>
  );
}
