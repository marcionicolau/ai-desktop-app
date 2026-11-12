// feature 017: ext.* bridge factory — the narrow capability-gated surface
// exposed to an extension BrowserView (FR-014). Every method checks the
// pack's declared capabilities; undeclared access → CAPABILITY_DENIED.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PackError } from "../fabric/errors";
import type { RunManager } from "../fabric/runtime";
import type { ComponentEngine } from "../fabric/components";
import { packDataDir } from "../store/paths";
import type { ExtContext } from "../../shared/ext-view-contract";
import type { Capability } from "../../shared/pack-schema";
import type { InstalledPackView, RunRecord, RunSummary } from "../../shared/types";

export interface BridgeDeps {
  engine: () => ComponentEngine;
  runs: () => RunManager | null;
  theme: () => ExtContext["theme"];
  // starts a run for ext.invoke; returns runId
  startRun: (packId: string, target: { kind: "pipeline" | "agent"; id: string }, params: Record<string, unknown>) => string;
  // T051: view-side error reports — not capability-gated (crash telemetry
  // must reach the host even for a pack that declared nothing)
  reportError?: (message: string) => void;
}

const denied = (cap: Capability) =>
  new PackError("CAPABILITY_DENIED", `pack did not declare capability "${cap}"`);

export function createViewBridge(pack: InstalledPackView, viewId: string, deps: BridgeDeps) {
  const caps = new Set(pack.manifest.capabilities);
  const need = (cap: Capability) => {
    if (!caps.has(cap)) throw denied(cap);
  };
  const dataFile = () => {
    const dir = packDataDir(pack.id);
    mkdirSync(dir, { recursive: true });
    return join(dir, "kv.json");
  };
  const readKv = (): Record<string, unknown> => {
    try {
      return JSON.parse(readFileSync(dataFile(), "utf8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  const writeKv = (kv: Record<string, unknown>) => writeFileSync(dataFile(), JSON.stringify(kv));

  const ownRun = (runId: string): RunRecord | null => {
    const r = deps.runs()?.get(runId) ?? null;
    return r && r.packId === pack.id ? r : null; // other packs' runs invisible
  };

  return {
    "ext.context": (): ExtContext => ({
      packId: pack.id,
      viewId,
      theme: deps.theme(),
      locale: "en",
    }),
    "ext.storage.get": ({ key }: { key: string }) => {
      need("storage");
      return { value: readKv()[key] ?? null };
    },
    "ext.storage.set": ({ key, value }: { key: string; value: unknown }) => {
      need("storage");
      const kv = readKv();
      kv[key] = value;
      writeKv(kv);
      return {};
    },
    "ext.storage.remove": ({ key }: { key: string }) => {
      need("storage");
      const kv = readKv();
      delete kv[key];
      writeKv(kv);
      return {};
    },
    "ext.runs.list": (): { runs: RunSummary[] } => {
      need("runs.read");
      return { runs: deps.runs()?.list(pack.id) ?? [] };
    },
    "ext.runs.get": ({ runId }: { runId: string }) => {
      need("runs.read");
      return { run: ownRun(runId) };
    },
    "ext.invoke": ({ commandId, args }: { commandId: string; args?: Record<string, unknown> }) => {
      need("commands.invoke");
      const cmd = pack.manifest.contributions.commands?.find((c) => c.id === commandId);
      if (!cmd) {
        throw new PackError("CONTRIBUTION_NOT_FOUND", `no command "${commandId}"`);
      }
      const target = cmd.run.pipeline
        ? { kind: "pipeline" as const, id: cmd.run.pipeline }
        : { kind: "agent" as const, id: cmd.run.agent! };
      return { runId: deps.startRun(pack.id, target, { ...cmd.run.params, ...args }) };
    },
    "ext.reportError": ({ message }: { message: string }) => {
      deps.reportError?.(typeof message === "string" ? message.slice(0, 500) : "unknown view error");
      return {};
    },
    "ext.models.generate": async ({ prompt, params }: { prompt: string; params?: Record<string, unknown> }) => {
      need("models.generate");
      if (typeof prompt !== "string" || prompt.length === 0) {
        throw new PackError("INVALID_PARAMS", "prompt must be a non-empty string");
      }
      let text = "";
      const res = await deps.engine().generate(prompt, (d) => { text += d; }, (params ?? null) as never, { roleKey: "ext" });
      return { text, usage: { promptTokens: res.promptTokens, outputTokens: res.tokens } };
    },
  };
}

export type ViewBridge = ReturnType<typeof createViewBridge>;
