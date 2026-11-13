// feature 023 (T035): script policy — mode select, per-runtime
// interpreter path + auto-detect + status badge, backend selector,
// session reset. Mirrors ToolSettings' settings.set merge pattern.
import { useEffect, useState } from "react";
import type { RuntimeStatus, ScriptPolicy, ScriptRuntimeKind } from "@shared/types";
import { invoke, on } from "@/lib/rpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const MODES: { value: ScriptPolicy["mode"]; label: string; hint: string }[] = [
  { value: "ask", label: "Ask each time", hint: "approve every script call" },
  { value: "allow-session", label: "Allow session scripts", hint: "grant once per conversation" },
  { value: "deny", label: "Off", hint: "no script calls run" },
];

const BACKENDS = [
  { value: "auto", label: "Auto (subprocess)" },
  { value: "subprocess", label: "Subprocess session" },
  { value: "embedded", label: "Embedded (prototype)" },
] as const;

const KINDS: { kind: ScriptRuntimeKind; label: string }[] = [
  { kind: "python", label: "Python" },
  { kind: "r", label: "R" },
];

export function ScriptsSettings() {
  const [policy, setPolicy] = useState<ScriptPolicy>({
    mode: "deny",
    backend: "auto",
  });
  const [runtimes, setRuntimes] = useState<RuntimeStatus[]>([]);
  const [paths, setPaths] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void invoke("settings.get", {}).then((s) => {
      if (s.scripts) {
        setPolicy(s.scripts);
        setPaths({
          python: s.scripts.runtimes?.python?.path ?? "",
          r: s.scripts.runtimes?.r?.path ?? "",
        });
      }
    });
    void invoke("runtime.list", {}).then((r) => setRuntimes(r.runtimes));
    const off = on("session.state", (e) => {
      setRuntimes((prev) =>
        prev.map((r) =>
          r.kind === e.runtime
            ? {
                ...r,
                session: {
                  state: e.state,
                  calls: r.session?.calls ?? 0,
                  restartCount: e.restartCount,
                },
              }
            : r,
        ),
      );
    });
    return off;
  }, []);

  const save = async (patch: Partial<ScriptPolicy>) => {
    setBusy(true);
    setError(null);
    try {
      const next = { ...policy, ...patch };
      await invoke("settings.set", { scripts: next });
      setPolicy(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const savePath = (kind: ScriptRuntimeKind) =>
    save({
      runtimes: {
        ...policy.runtimes,
        [kind]: { path: paths[kind] || undefined },
      },
    });

  const rt = (kind: ScriptRuntimeKind) => runtimes.find((r) => r.kind === kind);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Python &amp; R scripts</h2>
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">Script calls</span>
        <div className="flex gap-2">
          {MODES.map((m) => (
            <Button
              key={m.value}
              size="sm"
              variant={policy.mode === m.value ? "default" : "secondary"}
              disabled={busy}
              title={m.hint}
              onClick={() => void save({ mode: m.value })}
            >
              {m.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">Backend</span>
        <select
          className="flex h-9 rounded-md border bg-transparent px-2 text-sm"
          value={policy.backend ?? "auto"}
          disabled={busy}
          onChange={(e) =>
            void save({
              backend: e.target.value as ScriptPolicy["backend"],
            })
          }
        >
          {BACKENDS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
      </div>
      {KINDS.map(({ kind, label }) => {
        const r = rt(kind);
        return (
          <div key={kind} className="space-y-1 rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">{label}</span>
              {r && (
                <Badge variant={r.status === "ready" ? "secondary" : "destructive"}>
                  {r.status}
                </Badge>
              )}
              {r?.session && (
                <span className="text-xs text-muted-foreground">
                  session {r.session.state}
                  {r.session.restartCount > 0 &&
                    ` · ${r.session.restartCount} restarts`}
                </span>
              )}
              <div className="ml-auto flex gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void invoke("runtime.detect", { kind })
                      .then((x) => setPaths((p) => ({ ...p, [kind]: x.path })))
                      .then(() => void invoke("runtime.list", {}).then((x) => setRuntimes(x.runtimes)))
                      .catch((e) => setError((e as Error).message))
                  }
                >
                  Auto-detect
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void invoke("runtime.reset", { kind }).then(() =>
                      invoke("runtime.list", {}).then((x) =>
                        setRuntimes(x.runtimes),
                      ),
                    )
                  }
                >
                  Reset session
                </Button>
              </div>
            </div>
            <div className="flex gap-2">
              <Input
                className="font-mono text-xs"
                placeholder={r?.detectedPath ?? `path to ${label} interpreter`}
                value={paths[kind] ?? ""}
                onChange={(e) =>
                  setPaths((p) => ({ ...p, [kind]: e.target.value }))
                }
                onBlur={() => void savePath(kind)}
              />
            </div>
            {r?.detectedPath && (
              <p className="text-xs text-muted-foreground">
                detected: {r.detectedPath}
              </p>
            )}
          </div>
        );
      })}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
