import { SelectField } from "@/components/select-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { defaultFileName, validateDownload } from "./download-rules";
import { confirmLeave } from "../settings/use-unsaved-guard";
import { OverrideEditor } from "./OverrideEditor";
import { WithReason } from "@/components/with-reason";
import { confirm } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { EmptyState } from "@/components/empty-state";
import { IconLibrary } from "@/components/icons";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelAdvise, RoleView } from "@shared/types";
import { IconBenchmark, IconDownload, IconRefresh, IconSliders, IconSpinner } from "@/components/icons";
import type { DownloadState, ModelMeta } from "@shared/types";
import { invoke, on } from "@/lib/rpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Props {
  activeName: string | null;
  onLoad: (path: string) => void;
  // feature 018 (T007): when the startup prompt opened this drawer, a
  // completed download counts as the selection — auto-load it (FR-005/US2)
  autoLoadOnDownload?: boolean;
}

function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  return `${(n / 1e3).toFixed(0)} KB`;
}

const VERDICT: Record<ModelAdvise["verdict"], { label: string; cls: string }> = {
  fits: { label: "fits", cls: "text-success" },
  tight: { label: "tight", cls: "text-warning" },
  wontfit: { label: "won't fit", cls: "text-destructive" },
};

export function ModelLibrary({ activeName, onLoad, autoLoadOnDownload }: Props) {
  // refs so the one-shot download subscription sees current props
  const autoLoadRef = useRef(autoLoadOnDownload);
  autoLoadRef.current = autoLoadOnDownload;
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  const [models, setModels] = useState<ModelMeta[]>([]);
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [overrideFor, setOverrideFor] = useState<string | null>(null);
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
      const [{ models: list }, adv] = await Promise.all([
        invoke("model.list", {}),
        invoke("model.advise", {}),
      ]);
      setModels(list);
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
      await invoke("model.benchmark", { path: m.path }, { maxRequestTime: Infinity });
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
      if (p.phase === "done") {
        void (async () => {
          await refresh();
          if (autoLoadRef.current) {
            const m = (await invoke("model.list", {})).models.find(
              (x) => x.fileName === p.fileName,
            );
            if (m) onLoadRef.current(m.path);
          }
        })();
      }
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
      }, { maxRequestTime: Infinity });
      setUrl("");
      setFileName("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      notify.error("Download failed", {
        description: `${name}: ${msg}`,
        action: { label: "Retry", run: () => void download() },
      });
    }
  };

  return (
    <div className="border-b border-border bg-muted/40 px-4 py-3">
      <div className="mx-auto max-w-2xl space-y-3">
        {(() => {
          const errs = validateDownload(url, fileName);
          const canDownload =
            url.trim() !== "" &&
            !errs.url &&
            !errs.fileName &&
            (fileName.trim() !== "" || defaultFileName(url) !== "");
          return (
            <form
              className="space-y-3"
              aria-label="Download a model"
              onSubmit={(e) => {
                e.preventDefault();
                if (canDownload) void download();
              }}
            >
              <Field data-invalid={errs.url ? true : undefined}>
                <FieldLabel htmlFor="dl-url">Model link</FieldLabel>
                <Input
                  id="dl-url"
                  placeholder="https://huggingface.co/org/repo/resolve/main/model.gguf"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  aria-invalid={errs.url ? true : undefined}
                  className="text-sm"
                />
                {errs.url ? (
                  <FieldError>{errs.url}</FieldError>
                ) : (
                  <FieldDescription>A Hugging Face link to a .gguf file.</FieldDescription>
                )}
              </Field>
              <div className="flex flex-wrap items-start gap-3">
                <Field className="w-56" data-invalid={errs.fileName ? true : undefined}>
                  <FieldLabel htmlFor="dl-file">File name</FieldLabel>
                  <Input
                    id="dl-file"
                    placeholder={defaultFileName(url) || "model.gguf"}
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    aria-invalid={errs.fileName ? true : undefined}
                    className="text-sm"
                  />
                  {errs.fileName ? (
                    <FieldError>{errs.fileName}</FieldError>
                  ) : (
                    <FieldDescription>Optional — taken from the link.</FieldDescription>
                  )}
                </Field>
                <Field className="w-44">
                  <FieldLabel htmlFor="dl-tag">Use for role</FieldLabel>
                  <SelectField
                    id="dl-tag"
                    value={assignTag}
                    onValueChange={setAssignTag}
                    options={[
                      { value: "", label: "No role" },
                      ...tags.map((t) => ({ value: t.name, label: `→ ${t.label ?? t.name}` })),
                    ]}
                  />
                  <FieldDescription>Bind the file when it lands.</FieldDescription>
                </Field>
                <div className="mt-6 flex items-center gap-1">
                  <Button type="submit" size="sm" disabled={!canDownload}>
                    <IconDownload className="size-3.5" /> Download
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label="Refresh model list"
                    title="Refresh model list"
                    onClick={() => void refresh()}
                  >
                    <IconRefresh className="size-3.5" />
                  </Button>
                </div>
              </div>
            </form>
          );
        })()}
        {error && (
          <Alert variant="destructive" className="px-3 py-2 text-xs">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {Object.values(downloads).map((d) => (
          <div key={d.fileName} className="text-xs">
            {d.phase === "progress" && (
              <span className="text-warning">
                {d.fileName}: {fmtBytes(d.downloadedBytes)}
                {d.totalBytes ? ` / ${fmtBytes(d.totalBytes)}` : ""}
              </span>
            )}
            {d.phase === "done" && (
              <span className="text-success">{d.fileName}: downloaded</span>
            )}
            {d.phase === "error" && (
              <span className="text-destructive">
                {d.fileName}: {d.error ?? "failed"}
              </span>
            )}
          </div>
        ))}
        <div className="divide-y divide-border text-xs">
          {models.length === 0 && (
            <EmptyState
              icon={IconLibrary}
              title="No models yet"
              description="Download a .gguf model with the form above, or pick one from your disk."
            />
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
                      active && "text-success",
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
                    <span
                      className="flex items-center gap-1.5 text-warning"
                      role="status"
                      aria-label="Downloading"
                    >
                      <IconSpinner className="size-3.5 animate-spin" aria-hidden="true" />
                      {dl.totalBytes
                        ? `${Math.round((dl.downloadedBytes / dl.totalBytes) * 100)}%`
                        : fmtBytes(dl.downloadedBytes)}
                    </span>
                  ) : (
                    <>
                      <WithReason reason={active ? "This model is already loaded" : undefined}>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={active}
                          onClick={() => onLoad(m.path)}
                        >
                          Load
                        </Button>
                      </WithReason>
                      <WithReason
                        reason={
                          benching !== null && benching !== m.fileName
                            ? "Another benchmark is running"
                            : undefined
                        }
                      >
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={benching !== null}
                        aria-busy={benching === m.fileName}
                        aria-label={`Run benchmark for ${m.name ?? m.fileName}`}
                        title="Run bounded benchmark (≤30 s)"
                        onClick={() => void benchmark(m)}
                      >
                        {benching === m.fileName ? (
                          <IconSpinner className="size-3.5 animate-spin" />
                        ) : (
                          <IconBenchmark className="size-3.5" />
                        )}
                      </Button>
                      </WithReason>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Generation overrides for ${m.name ?? m.fileName}`}
                        title="Per-model generation overrides"
                        aria-expanded={overrideFor === m.fileName}
                        onClick={() =>
                          void (async () => {
                            // closing an editor with unsaved edits asks first
                            if (overrideFor === m.fileName && !(await confirmLeave())) return;
                            setOverrideFor(overrideFor === m.fileName ? null : m.fileName);
                          })()
                        }
                      >
                        <IconSliders className="size-3.5" />
                      </Button>
                    </>
                  )}
                </div>
                {overrideFor === m.fileName && (
                  <OverrideEditor fileName={m.fileName} onClose={() => setOverrideFor(null)} />
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
              onClick={() =>
                void (async () => {
                  const ok = await confirm({
                    title: "Clear saved conversation state",
                    itemName: `${snapStats.count} snapshot${snapStats.count === 1 ? "" : "s"}`,
                    consequence:
                      "Chats re-read their history the next time you continue them, which is slower once.",
                    confirmLabel: "Clear",
                  });
                  if (!ok) return;
                  await invoke("snapshot.clear", {});
                  setSnapStats((s) => (s ? { ...s, count: 0, usedBytes: 0 } : s));
                  notify.success("Snapshots cleared");
                })()
              }
            >
              Clear snapshots
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
