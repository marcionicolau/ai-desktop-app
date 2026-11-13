// feature 027 (US2, FR-008/009/010/013/014): import flow — the native
// multi-select picker feeds this preview; per-row language + editable id
// + inline errors; Link (default) or Copy for the batch; results shown
// per file and one failure never aborts the rest.
import { useState } from "react";
import type { ScriptImportCandidate, ScriptImportResult } from "@shared/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useScripts } from "./use-scripts";

const RT_LABEL = { python: "Python", r: "R" } as const;

export function ImportScriptsDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const { pickImport, importFiles } = useScripts();
  const [candidates, setCandidates] = useState<ScriptImportCandidate[] | null>(null);
  const [ids, setIds] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"link" | "copy">("link");
  const [results, setResults] = useState<ScriptImportResult[] | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setCandidates(null);
    setIds({});
    setMode("link");
    setResults(null);
  };

  // picking happens on open — the native dialog must show above this one
  const pick = async () => {
    setBusy(true);
    try {
      const c = await pickImport();
      setCandidates(c);
      setIds(Object.fromEntries(c.map((x) => [x.path, x.suggestedId])));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!candidates) return;
    setBusy(true);
    try {
      const files = candidates
        .filter((c) => !c.error)
        .map((c) => ({ path: c.path, id: ids[c.path] ?? c.suggestedId }));
      const r = await importFiles({ mode, files });
      setResults(r);
      onImported();
    } finally {
      setBusy(false);
    }
  };

  const valid = (candidates ?? []).filter((c) => !c.error);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
        if (o) void pick();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import scripts from files</DialogTitle>
          <DialogDescription>
            Pick .py or .r files — each becomes a script you can run. Linked
            files stay where they are and are re-read on every run.
          </DialogDescription>
        </DialogHeader>

        {results ? (
          <ul className="max-h-80 space-y-1.5 overflow-y-auto text-sm">
            {results.map((r) => (
              <li key={r.path} className="flex items-center justify-between gap-3 rounded-md border px-3 py-1.5">
                <span className="min-w-0 truncate font-mono text-xs" title={r.path}>
                  {r.path}
                </span>
                <Badge
                  variant={
                    r.status === "imported" ? "secondary" : r.status === "duplicate" ? "outline" : "destructive"
                  }
                  title={r.reason}
                >
                  {r.status === "duplicate" ? `duplicate${r.id ? ` of ${r.id}` : ""}` : r.status}
                </Badge>
              </li>
            ))}
          </ul>
        ) : candidates === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {busy ? "Waiting for the file picker…" : "No files picked."}
          </p>
        ) : (
          <div className="space-y-3">
            <ul className="max-h-64 space-y-1.5 overflow-y-auto">
              {candidates.map((c) => (
                <li key={c.path} className="flex items-center gap-2 rounded-md border px-3 py-1.5">
                  <Badge variant="secondary">{RT_LABEL[c.runtime]}</Badge>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs" title={c.path}>
                    {c.fileName}
                  </span>
                  {c.error ? (
                    <span className="text-xs text-destructive" title={c.error.reason}>
                      {c.error.reason}
                    </span>
                  ) : (
                    <Input
                      aria-label={`Id for ${c.fileName}`}
                      className="h-7 w-44 font-mono text-xs"
                      value={ids[c.path] ?? ""}
                      onChange={(e) => setIds((m) => ({ ...m, [c.path]: e.target.value }))}
                    />
                  )}
                  {c.duplicateOf && (
                    <span className="text-xs text-warning" title={`Already linked as ${c.duplicateOf}`}>
                      duplicate
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <RadioGroup
              className="flex gap-4"
              value={mode}
              onValueChange={(v) => setMode(v as "link" | "copy")}
            >
              <label className="flex items-center gap-1.5 text-sm">
                <RadioGroupItem value="link" /> Link (default) — run the file in place
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <RadioGroupItem value="copy" /> Copy — store a snapshot in the library
              </label>
            </RadioGroup>
          </div>
        )}

        <DialogFooter>
          {results ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={busy || valid.length === 0} onClick={() => void confirm()}>
                Import {valid.length > 0 ? `${valid.length} file${valid.length > 1 ? "s" : ""}` : ""}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
