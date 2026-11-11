// feature 015 (T020): local tool policy — sandbox root picker plus
// approval mode. "Allow reads this session" grants are per-conversation,
// memory-only (FR-004); switching conversations prompts again.
import { useEffect, useState } from "react";
import type { ToolPolicy } from "@shared/types";
import { invoke } from "@/lib/rpc";
import { Button } from "@/components/ui/button";

const MODES: { value: ToolPolicy["mode"]; label: string; hint: string }[] = [
  { value: "ask", label: "Ask each time", hint: "approve every read" },
  { value: "allow-read-session", label: "Allow session reads", hint: "grant once per conversation" },
  { value: "deny", label: "Off", hint: "no tool calls run" },
];

export function ToolSettings() {
  const [policy, setPolicy] = useState<ToolPolicy>({
    sandboxRoot: null,
    mode: "deny",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void invoke("settings.get", {}).then((s) => {
      if (s.tools) setPolicy(s.tools);
    });
  }, []);

  const save = async (patch: Partial<ToolPolicy>) => {
    setBusy(true);
    setError(null);
    try {
      await invoke("settings.set", { tools: patch });
      setPolicy((p) => ({ ...p, ...patch }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickRoot = async () => {
    const r = await invoke("tool.pickRoot", {});
    if (r.path) void save({ sandboxRoot: r.path });
  };

  return (
    <div className="border-b border-border bg-muted/40 px-4 py-3">
      <div className="mx-auto flex max-w-2xl flex-col gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Local tools — model may read files inside the sandbox root
        </span>
        <div className="flex items-center gap-2">
          <span
            className="min-w-0 flex-1 truncate font-mono text-xs"
            title={policy.sandboxRoot ?? undefined}
          >
            {policy.sandboxRoot ?? "No sandbox root — tools inactive"}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void pickRoot()}
          >
            Browse…
          </Button>
          {policy.sandboxRoot && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void save({ sandboxRoot: null })}
            >
              Clear
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {MODES.map((m) => (
            <label
              key={m.value}
              className="flex items-center gap-1.5 text-xs"
            >
              <input
                type="radio"
                name="tool-mode"
                checked={policy.mode === m.value}
                disabled={busy}
                onChange={() => void save({ mode: m.value })}
              />
              {m.label}
              <span className="text-muted-foreground">({m.hint})</span>
            </label>
          ))}
        </div>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}
