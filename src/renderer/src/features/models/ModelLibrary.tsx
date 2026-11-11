import { useCallback, useEffect, useState } from "react";
import type { ModelAdvise, RoleView } from "@shared/types";
import { Download, Gauge, Loader2, RefreshCw, SlidersHorizontal } from "lucide-react";
import type { DownloadState, GenerationParams, ModelMeta } from "@shared/types";
import { invoke, on } from "@/lib/rpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Props {
  activeName: string | null;
  onLoad: (path: string) => void;
}

const OVERRIDE_FIELDS: { key: keyof GenerationParams; label: string }[] = [
  { key: "temperature", label: "Temp" },
  { key: "topP", label: "Top-p" },
  { key: "topK", label: "Top-k" },
  { key: "repeatPenalty", label: "Penalty" },
  { key: "seed", label: "Seed" },
  { key: "maxTokens", label: "Max tok" },
];

function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  return `${(n / 1e3).toFixed(0)} KB`;
}

const VERDICT: Record<ModelAdvise["verdict"], { label: string; cls: string }> = {
  fits: { label: "fits", cls: "text-emerald-400" },
  tight: { label: "tight", cls: "text-amber-400" },
  wontfit: { label: "won't fit", cls: "text-red-400" },
};

function defaultFileName(url: string): string {
  try {
    const tail = new URL(url).pathname.split("/").pop() ?? "";
    return tail.endsWith(".gguf") ? tail : "";
  } catch {
    return "";
  }
}

export function ModelLibrary({ activeName, onLoad }: Props) {
  const [models, setModels] = useState<ModelMeta[]>([]);
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<GenerationParams>>({});
  const [tags, setTags] = useState<RoleView[]>([]);
  const [assignTag, setAssignTag] = useState("");
  // feature 011: live verdicts keyed by fileName; null = not fetched yet
  const [advise, setAdvise] = useState<Map<string, ModelAdvise>>(new Map());
  const [benching, setBenching] = useState<string | null>(null);
  // feature 010: KV snapshot disk usage (US2)
  const [snapStats, setSnapStats] = useState<{
    count: number;
    usedBytes: number;
    maxBytes: number;
  } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [{ models }, adv] = await Promise.all([
        invoke("model.list", {}),
        invoke("model.advise", {}),
      ]);
      setModels(models);
      setAdvise(new Map(adv.models.map((a) => [a.fileName, a])));
    } catch {
      // list is best-effort
    }
    try {
      setSnapStats(await invoke("snapshot.stats", {}));
    } catch {
      /* older builds lack the method */
    }
  }, []);

  const benchmark = async (m: ModelMeta) => {
    setBenching(m.fileName);
    setError(null);
    try {
      await invoke("model.benchmark", { path: m.path });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBenching(null);
    }
  };

  useEffect(() => {
    void refresh();
    void (async () => {
      try {
        const res = await invoke("role.list", {});
        setTags(res.tags);
      } catch {
        // roles surface is optional here
      }
    })();
    return on("model.download", (p) => {
      setDownloads((d) => ({ ...d, [p.fileName]: p }));
      if (p.phase === "done") void refresh();
      if (p.phase === "error") setError(p.error ?? "download failed");
    });
  }, [refresh]);

  const download = async () => {
    const name = (fileName.trim() || defaultFileName(url)).trim();
    setError(null);
    try {
      await invoke("model.download", {
        url: url.trim(),
        fileName: name,
        tagName: assignTag || undefined,
      });
      setUrl("");
      setFileName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const saveOverride = async (file: string, params: Partial<GenerationParams> | null) => {
    setError(null);
    try {
      await invoke("model.setOverride", { fileName: file, params });
      setOverrideFor(null);
      setDraft({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="border-b border-border bg-muted/40 px-4 py-3">
      <div className="mx-auto max-w-2xl space-y-3">
        <div className="flex items-center gap-2">
          <Input
            placeholder="https://huggingface.co/org/repo/resolve/rev/model.gguf"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="h-8 flex-1 text-xs"
          />
          <Input
            placeholder="file.gguf (optional)"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            className="h-8 w-44 text-xs"
          />
          <select
            className="h-8 w-36 rounded border border-border bg-background px-1 text-xs"
            value={assignTag}
            onChange={(e) => setAssignTag(e.target.value)}
            title="Bind the downloaded file to a role tag"
          >
            <option value="">no tag</option>
            {tags.map((t) => (
              <option key={t.name} value={t.name}>
                → {t.label ?? t.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={!url.trim() || !(fileName.trim() || defaultFileName(url))}
            onClick={() => void download()}
          >
            <Download className="size-3.5" /> Download
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void refresh()}>
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {Object.values(downloads).map((d) => (
          <div key={d.fileName} className="text-xs">
            {d.phase === "progress" && (
              <span className="text-amber-400">
                {d.fileName}: {fmtBytes(d.downloadedBytes)}
                {d.totalBytes ? ` / ${fmtBytes(d.totalBytes)}` : ""}
              </span>
            )}
            {d.phase === "done" && (
              <span className="text-emerald-400">{d.fileName}: downloaded</span>
            )}
            {d.phase === "error" && (
              <span className="text-red-400">
                {d.fileName}: {d.error ?? "failed"}
              </span>
            )}
          </div>
        ))}
        <div className="divide-y divide-border text-xs">
          {models.length === 0 && (
            <p className="py-2 text-muted-foreground">
              No .gguf files in the models folder yet — download one above or
              use Model → browse.
            </p>
          )}
          {models.map((m) => {
            const dl = downloads[m.fileName];
            const active = activeName === m.fileName;
            return (
              <div key={m.fileName} className="py-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex-1 truncate font-medium",
                      active && "text-emerald-400",
                    )}
                    title={m.path}
                  >
                    {m.name ?? m.fileName}
                    {active && " (active)"}
                  </span>
                  <span className="text-muted-foreground">
                    {m.paramCount ?? "?"} · {m.quantization ?? "?"} ·{" "}
                    {fmtBytes(m.sizeBytes)}
                    {m.contextTrain ? ` · ctx ${m.contextTrain}` : ""}
                  </span>
                  {(() => {
                    const a = advise.get(m.fileName);
                    if (!a) return null;
                    const v = VERDICT[a.verdict];
                    return (
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        {a.benchmark ? (
                          <span title={`measured ${new Date(a.benchmark.measuredAt).toLocaleDateString()}${a.benchmark.partial ? " (partial run)" : ""}`}>
                            {a.benchmark.tokensPerSec.toFixed(1)} tok/s ·{" "}
                            {fmtBytes(a.benchmark.peakBytes)}
                          </span>
                        ) : (
                          <span title="run a benchmark for measured figures">
                            not measured
                          </span>
                        )}
                        <span className={v.cls} title={`${a.basis} basis · ctx ≤ ${a.recommendedCtx}`}>
                          {v.label}
                          {a.basis === "estimated" && "·est"}
                        </span>
                      </span>
                    );
                  })()}
                  {dl?.phase === "progress" ? (
                    <Loader2 className="size-3.5 animate-spin text-amber-400" />
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={active}
                        onClick={() => onLoad(m.path)}
                      >
                        Load
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={benching !== null}
                        title="Run bounded benchmark (≤30 s)"
                        onClick={() => void benchmark(m)}
                      >
                        {benching === m.fileName ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Gauge className="size-3.5" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Per-model generation overrides"
                        onClick={() =>
                          setOverrideFor(
                            overrideFor === m.fileName ? null : m.fileName,
                          )
                        }
                      >
                        <SlidersHorizontal className="size-3.5" />
                      </Button>
                    </>
                  )}
                </div>
                {overrideFor === m.fileName && (
                  <div className="mt-2 space-y-2 rounded-md border border-border p-2">
                    <p className="text-muted-foreground">
                      Overrides for {m.fileName} — only changed fields apply;
                      empty fields use global settings.
                    </p>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                      {OVERRIDE_FIELDS.map((f) => (
                        <label key={f.key} className="flex flex-col gap-1">
                          <span className="text-muted-foreground">{f.label}</span>
                          <Input
                            type="number"
                            step="any"
                            placeholder="—"
                            value={draft[f.key] ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setDraft((d) => ({
                                ...d,
                                [f.key]: v === "" ? undefined : Number(v),
                              }));
                            }}
                            className="h-7 text-xs"
                          />
                        </label>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          const params = Object.fromEntries(
                            Object.entries(draft).filter(
                              ([, v]) => v !== undefined && Number.isFinite(v),
                            ),
                          );
                          void saveOverride(m.fileName, params);
                        }}
                      >
                        Save override
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void saveOverride(m.fileName, null)}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {snapStats && (
          <div className="flex items-center justify-between rounded border border-border px-3 py-2 text-xs text-muted-foreground">
            <span>
              KV snapshots: {snapStats.count} ·{" "}
              {fmtBytes(snapStats.usedBytes)} of{" "}
              {snapStats.maxBytes > 0 ? fmtBytes(snapStats.maxBytes) : "disabled"}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={snapStats.count === 0}
              onClick={() => {
                void invoke("snapshot.clear", {}).then(() =>
                  setSnapStats((s) =>
                    s ? { ...s, count: 0, usedBytes: 0 } : s,
                  ),
                );
              }}
            >
              Clear snapshots
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
