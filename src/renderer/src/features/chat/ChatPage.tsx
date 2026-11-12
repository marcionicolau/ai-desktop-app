import { useEffect, useRef, useState } from "react";
import {
  GitBranch,
  Library,
  Puzzle,
  Settings2,
  Tags,
  Users,
} from "lucide-react";
import { useChat } from "./use-chat";
import { MessageList } from "./MessageList";
import { BranchOverview } from "./BranchOverview";
import { Composer } from "./Composer";
import { Sidebar } from "./Sidebar";
import { ModelLibrary } from "../models/ModelLibrary";
import { decideStartupPrompt } from "./startup-prompt";
import { ToolSettings } from "../settings/ToolSettings";
import { DataPanel } from "../settings/DataPanel";
import { RolesPanel } from "../roles/RolesPanel";
import { FusionControls } from "../roles/FusionControls";
import { PersonasPanel } from "../personas/PersonasPanel";
import { usePersonas } from "../personas/use-personas";
import { OutputPanel } from "../metrics/OutputPanel";
import { ExtensionsPanel } from "../extensions/ExtensionsPanel";
import { WorkspaceBrowser } from "../extensions/WorkspaceBrowser";
import { RunView } from "../extensions/RunView";
import { ExtViewHost } from "../extensions/ExtViewHost";
import { WorkspaceAccordion } from "../workspace/WorkspaceAccordion";
import { useWorkspaceItems } from "../workspace/use-workspace-items";
import { invoke } from "@/lib/rpc";
import { Button } from "@/components/ui/button";

export function ChatPage() {
  const {
    state,
    path,
    variants,
    branches,
    send,
    stop,
    selectConversation,
    newConversation,
    renameConversation,
    deleteConversation,
    exportConversation,
    importConversation,
    regenerate,
    editMessage,
    loadModel,
    setMode,
    setPersona,
    selectVariant,
  } = useChat();
  const modelReady = state.modelStatus === "ready";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [personasOpen, setPersonasOpen] = useState(false);
  // feature 006: preferred-tag offer from conversation.setPersona —
  // suggestion only; the user applies or dismisses
  const [tagOffer, setTagOffer] = useState<string | null>(null);
  // feature 016 (T012): header switch → persisted settings.outputPanel;
  // the same flag gates collection on the bun side
  const [metricsOpen, setMetricsOpen] = useState(false);
  // feature 017: extensions drawer + focused workspace/run/view sessions
  const [extOpen, setExtOpen] = useState(false);
  const [browsePack, setBrowsePack] = useState<string | null>(null);
  const [focusRun, setFocusRun] = useState<string | null>(null);
  const [openView, setOpenView] = useState<{
    packId: string;
    viewId: string;
    slot: "tab" | "panel";
  } | null>(null);
  // feature 019: the workspace tab system is owned by ChatPage — the chat
  // tab hosts MessageList..Composer; ext `tab` views are peer tabs
  const { tabs, selectedId, select, focusView } = useWorkspaceItems();
  // feature 018 (T003/T004): first-launch auto-open of the model library.
  // Evaluates once, after model.status hydration, on the first terminal
  // status — never during "loading", never again this session (FR-001/4/6)
  const startupEval = useRef(false);
  const [startupPrompted, setStartupPrompted] = useState(false);
  useEffect(() => {
    const d = decideStartupPrompt({
      hydrated: state.modelStatusHydrated,
      evaluated: startupEval.current,
      status: state.modelStatus,
    });
    if (d === "wait") return;
    startupEval.current = true;
    if (d === "open") {
      setLibraryOpen(true);
      setStartupPrompted(true);
    }
    // "settle" (ready) — evaluated latch alone suppresses future prompts
  }, [state.modelStatusHydrated, state.modelStatus]);
  // dismissal = closing the auto-opened library before a model is ready
  // (FR-004); a ready transition just ends the prompted state (T004)
  useEffect(() => {
    if (startupPrompted && (!libraryOpen || state.modelStatus === "ready")) {
      setStartupPrompted(false);
    }
  }, [libraryOpen, startupPrompted, state.modelStatus]);
  useEffect(() => {
    void invoke("settings.get", {}).then((s) => setMetricsOpen(s.outputPanel));
  }, []);
  const toggleMetrics = async (v: boolean) => {
    setMetricsOpen(v);
    await invoke("settings.set", { outputPanel: v });
  };
  const { personas, snippets } = usePersonas();

  const onPersona = async (name: string | null) => {
    const r = await setPersona(name);
    // hide the offer for unbound tags — there's nothing to apply
    if (r?.suggestedTag) {
      try {
        await invoke("role.resolve", { name: r.suggestedTag });
        setTagOffer(r.suggestedTag);
      } catch {
        setTagOffer(null);
      }
    } else {
      setTagOffer(null);
    }
  };

  // apply path differs by mode: single loads the tag's resolved model,
  // fusion re-picks the executor tag (persona steers the executor)
  const applyTagOffer = async () => {
    const tag = tagOffer;
    setTagOffer(null);
    if (!tag) return;
    try {
      if (state.mode === "fusion") {
        await setMode("fusion", state.plannerTag, tag);
      } else {
        const r = await invoke("role.resolve", { name: tag });
        await loadModel(r.resolved.path);
      }
    } catch {
      // tag went unbound between offer and apply — drop quietly
    }
  };

  return (
    <main className="flex h-screen bg-background text-foreground">
      <Sidebar
        conversations={state.conversations}
        activeId={state.conversationId}
        onSelect={(id) => void selectConversation(id)}
        onNew={newConversation}
        onRename={(id, t) => void renameConversation(id, t)}
        onDelete={(id) => void deleteConversation(id)}
        onExport={(id, f) => exportConversation(id, f)}
        onImport={importConversation}
        onSelectHit={(cid, mid) => void selectConversation(cid, mid)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-2">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold">AI Desktop App</h1>
            {/* feature 006 (FR-006): per-conversation persona badge/select */}
            <select
              value={state.personaName ?? ""}
              onChange={(e) => void onPersona(e.target.value || null)}
              className="h-7 max-w-36 rounded border border-border bg-background px-1.5 text-xs"
              title="Persona for this conversation"
              aria-label="Persona"
            >
              <option value="">No persona</option>
              {personas.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Personas"
              title="Personas"
              onClick={() => setPersonasOpen((v) => !v)}
            >
              <Users className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Branches"
              title="Branches"
              disabled={branches.length === 0}
              onClick={() => setBranchesOpen((v) => !v)}
            >
              <GitBranch className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Model library"
              title="Model library"
              onClick={() => setLibraryOpen((v) => !v)}
            >
              <Library className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Model roles"
              title="Model roles"
              onClick={() => setRolesOpen((v) => !v)}
            >
              <Tags className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Generation settings"
              title="Generation settings"
              onClick={() => setSettingsOpen((v) => !v)}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Extensions"
              title="Extensions"
              onClick={() => setExtOpen((v) => !v)}
            >
              <Puzzle className="h-4 w-4" />
            </Button>
            <label
              className="flex cursor-pointer items-center gap-1 px-1 text-xs"
              title="Output metrics panel"
            >
              <input
                type="checkbox"
                checked={metricsOpen}
                onChange={(e) => void toggleMetrics(e.target.checked)}
                aria-label="Output metrics panel"
              />
              Metrics
            </label>
            {state.modelName && (
              <span
                className="max-w-40 truncate text-xs text-muted-foreground"
                title={state.modelName}
              >
                {state.modelName}
              </span>
            )}
          </div>
        </header>
        {settingsOpen && (
          <>
            <ToolSettings />
            <DataPanel />
          </>
        )}
        {rolesOpen && <RolesPanel />}
        {personasOpen && <PersonasPanel />}
        {tagOffer && (
          <div className="flex items-center justify-center gap-2 border-b border-border bg-muted px-4 py-2 text-xs">
            <span>
              This persona prefers the "{tagOffer}" role — apply it to this
              conversation?
            </span>
            <Button size="sm" onClick={() => void applyTagOffer()}>
              Apply
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setTagOffer(null)}>
              Dismiss
            </Button>
          </div>
        )}
        {libraryOpen && (
          <ModelLibrary
            activeName={state.modelName}
            onLoad={(p) => void loadModel(p)}
            autoLoadOnDownload={startupPrompted}
          />
        )}
        {state.modelStatus === "unloaded" && (
          <button
            className="w-full border-b border-border bg-muted px-4 py-2 text-center text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setLibraryOpen(true)}
          >
            No model is loaded — click to pick a .gguf file to start chatting.
          </button>
        )}
        {state.modelStatus === "error" && (
          <div className="border-b border-border bg-red-950 px-4 py-2 text-center text-sm text-red-300">
            Model failed to load
            {state.modelError ? `: ${state.modelError}` : ""}
          </div>
        )}
        <FusionControls
          mode={state.mode}
          plannerTag={state.plannerTag}
          executorTag={state.executorTag}
          generating={state.generatingId !== null}
          onSetMode={setMode}
          onUnbound={() => setRolesOpen(true)}
        />
        {state.notice && (
          <div className="border-b border-border bg-amber-950 px-4 py-2 text-center text-sm text-amber-300">
            {state.notice}
          </div>
        )}
        {state.lastError && (
          <div className="border-b border-border bg-red-950 px-4 py-2 text-center text-sm text-red-300">
            {state.lastError.code}: {state.lastError.message}
          </div>
        )}
        {branchesOpen && (
          <BranchOverview
            branches={branches}
            pathIds={new Set(path.map((m) => m.id))}
            onSelect={selectVariant}
            onClose={() => setBranchesOpen(false)}
          />
        )}
        <WorkspaceAccordion
          tabs={tabs}
          selectedId={selectedId}
          select={select}
          focusView={focusView}
          focusRunId={focusRun}
          onRunStarted={setFocusRun}
          onOpenPanelView={(packId, viewId) => {
            setOpenView({ packId, viewId, slot: "panel" });
            select("chat");
          }}
          onCloseTab={(packId) => void invoke("extension.disable", { packId })}
          chat={
            <>
              <MessageList
                messages={path}
                variants={variants}
                generating={state.generatingId !== null}
                scrollToId={state.scrollTarget}
                onRegenerate={(id) => void regenerate(id)}
                onEdit={(id, c) => void editMessage(id, c)}
                onSelectVariant={selectVariant}
              />
              {extOpen && (
                <ExtensionsPanel onBrowse={(packId) => setBrowsePack(packId)} />
              )}
              {extOpen && browsePack && (
                <WorkspaceBrowser
                  packId={browsePack}
                  onRunStarted={(runId) => setFocusRun(runId)}
                  onOpenView={(packId, viewId, slot) =>
                    slot === "tab"
                      ? focusView(packId, viewId)
                      : setOpenView({ packId, viewId, slot })
                  }
                />
              )}
              {extOpen && <RunView focusRunId={focusRun} />}
              {extOpen && openView && (
                <ExtViewHost
                  packId={openView.packId}
                  viewId={openView.viewId}
                  slot={openView.slot}
                  onClose={() => setOpenView(null)}
                />
              )}
              <Composer
                generating={state.generatingId !== null}
                modelReady={modelReady}
                snippets={snippets}
                onSend={(c, ids, chips) => void send(c, ids, chips)}
                onStop={stop}
                onPickModel={() => setLibraryOpen(true)}
              />
              {/* feature 016: bottom dock — sibling shrinks the message area */}
              <OutputPanel open={metricsOpen} />
            </>
          }
        />
      </div>
    </main>
  );
}
