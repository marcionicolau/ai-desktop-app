// feature 017 (US1): pack lifecycle UI — install (folder/archive/url),
// consent-gated enable, disable, remove. Panel lives under the header like
// the other feature panels; state refreshes on extension.changed.
import { useEffect, useState } from "react";
import type { InstalledPackView } from "@shared/types";
import { invoke, on } from "@/lib/rpc";
import { Button } from "@/components/ui/button";

interface Props {
  onBrowse: (packId: string) => void;
  onOpenView: (packId: string, viewId: string, slot: "tab" | "panel") => void;
}

export function ExtensionsPanel({ onBrowse, onOpenView }: Props) {
  const [packs, setPacks] = useState<InstalledPackView[]>([]);
  const [url, setUrl] = useState("");
  const [consentFor, setConsentFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    void invoke("extension.scan", {}).then((r) => setPacks(r.packs));
  };
  useEffect(() => {
    refresh();
    return on("extension.changed", refresh);
  }, []);

  const guard = (p: Promise<unknown>) =>
    p.then(() => setError(null)).catch((e: Error) => setError(e.message));

  const install = (kind: "folder" | "archive" | "url") => {
    const source =
      kind === "url"
        ? { kind: "url" as const, url }
        : { kind, path: "" }; // empty path → main opens the picker
    // folder/archive open a picker, url can fetch slowly — no timeout
    void guard(invoke("extension.install", { source }, { maxRequestTime: Infinity }));
    if (kind === "url") setUrl("");
  };

  // After enable: surface the pack — open its contributions browser and,
  // if it declares a tab view, that view directly.
  const afterEnable = (p: InstalledPackView) => {
    onBrowse(p.id);
    const tab = p.manifest.contributions.views?.find((v) => v.slot === "tab");
    if (tab) onOpenView(p.id, tab.id, "tab");
  };

  const enable = (p: InstalledPackView) => {
    // FR-005: capability-declaring packs need explicit consent
    if (p.manifest.capabilities.length > 0) {
      setConsentFor(p.id);
      return;
    }
    void guard(invoke("extension.enable", { packId: p.id }).then(() => afterEnable(p)));
  };

  return (
    <div className="border-b border-border px-4 py-2 text-sm" data-testid="extensions-panel">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-medium">Extension packs</span>
        <Button size="sm" variant="secondary" onClick={() => install("folder")}>
          Install folder
        </Button>
        <Button size="sm" variant="secondary" onClick={() => install("archive")}>
          Install archive
        </Button>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://… pack URL"
          className="h-7 min-w-40 flex-1 rounded border border-border bg-background px-2 text-xs"
          aria-label="Pack URL"
        />
        <Button size="sm" variant="secondary" disabled={!url} onClick={() => install("url")}>
          Fetch
        </Button>
      </div>
      {error && (
        <div className="mb-2 rounded bg-red-950 px-2 py-1 text-xs text-red-300">{error}</div>
      )}
      {packs.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No packs installed — install a folder, archive, or URL to get started.
        </p>
      )}
      <ul className="space-y-1">
        {packs.map((p) => (
          <li key={p.id} className="rounded border border-border p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="font-medium">{p.manifest.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  v{p.manifest.version} · {p.state}
                </span>
                {p.manifest.description && (
                  <p className="truncate text-xs text-muted-foreground">
                    {p.manifest.description}
                  </p>
                )}
                {p.error && (
                  <p className="text-xs text-red-400">
                    {p.error.code}: {p.error.message}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                {p.state === "enabled" ? (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => onBrowse(p.id)}>
                      Browse
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void guard(invoke("extension.disable", { packId: p.id }))
                      }
                    >
                      Disable
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => enable(p)}>
                    Enable
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void guard(
                      invoke("extension.remove", { packId: p.id, purgeData: true }),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            </div>
            {consentFor === p.id && (
              <div className="mt-2 rounded bg-muted p-2 text-xs">
                <p className="mb-1">
                  This pack requests capabilities:{" "}
                  <strong>{p.manifest.capabilities.join(", ") || "none"}</strong>
                </p>
                <Button
                  size="sm"
                  onClick={() => {
                    setConsentFor(null);
                    void guard(
                      invoke("extension.enable", { packId: p.id, consent: true }).then(() =>
                        afterEnable(p),
                      ),
                    );
                  }}
                >
                  Allow and enable
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-1"
                  onClick={() => setConsentFor(null)}
                >
                  Cancel
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
