import { useEffect, useRef, useState } from "react";
import { GitBranch } from "lucide-react";
import { useChat } from "./use-chat";
import { MessageList } from "./MessageList";
import { BranchOverview } from "./BranchOverview";
import { Composer } from "./Composer";
import { AppSidebar } from "./AppSidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ModelSelector } from "@/components/ai/model-selector";
import { useRoles } from "../roles/use-roles";
import { ModelLibrary } from "../models/ModelLibrary";
import { SetupPanel } from "../setup/SetupPanel";
import { SetupScreen } from "../setup/SetupScreen";
import { useSetup } from "../setup/use-setup";
import { decideStartupPrompt } from "./startup-prompt";
import { ToolSettings } from "../settings/ToolSettings";
import { UpdatesSection } from "../settings/UpdatesSection";
import { UpdateBanner } from "../update/UpdateBanner";
import { DataPanel } from "../settings/DataPanel";
import { RolesPanel } from "../roles/RolesPanel";
import { FusionControls } from "../roles/FusionControls";
import { PersonasPanel } from "../personas/PersonasPanel";
import { ScriptsPage } from "../scripts/ScriptsPage";
import { ScriptsSettings } from "../settings/ScriptsSettings";
import { usePersonas } from "../personas/use-personas";
import { OutputPanel } from "../metrics/OutputPanel";
import { ExtensionsPanel } from "../extensions/ExtensionsPanel";
import { WorkspaceBrowser } from "../extensions/WorkspaceBrowser";
import { RunView } from "../extensions/RunView";
import { ExtViewHost } from "../extensions/ExtViewHost";
import { WorkspacePanels } from "../workspace/WorkspacePanels";
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
  // feature 021: header model selectors list bound role tags; single mode
  // applies via role.resolve → loadModel, fusion re-picks via setMode
  const { tags: roleTags } = useRoles();
  const boundTags = roleTags
    .filter((t) => t.state === "bound")
    .map((t) => ({
      id: t.name,
      label: t.label || t.name,
      hint: t.resolvedFile?.fileName,
    }));
  const modelTagName =
    roleTags.find(
      (t) =>
        t.state === "bound" && t.resolvedFile?.fileName === state.modelName,
    )?.name ?? null;
  const applyTag = async (tag: string) => {
    const r = await invoke("role.resolve", { name: tag });
    await loadModel(r.resolved.path);
  };
  const [branchesOpen, setBranchesOpen] = useState(false);
  // feature 006: preferred-tag offer from conversation.setPersona —
  // suggestion only; the user applies or dismisses
  const [tagOffer, setTagOffer] = useState<string | null>(null);
  // feature 016 (T012): header switch → persisted settings.outputPanel;
  // the same flag gates collection on the bun side
  const [metricsOpen, setMetricsOpen] = useState(false);
  // feature 017/021: extension browse/run/view sessions — rendered inside
  // the "extensions" workspace surface
  const [browsePack, setBrowsePack] = useState<string | null>(null);
  const [focusRun, setFocusRun] = useState<string | null>(null);
  const [openView, setOpenView] = useState<{
    packId: string;
    viewId: string;
    slot: "tab" | "panel";
  } | null>(null);
  // feature 020/021: workspace panels are owned by ChatPage — every item
  // (chat, ext `tab` views, pack browsers, surfaces) is a mounted-hidden
  // full-screen panel; the sidebar selects which one is visible
  const { tabs, selectedId, select, focusView, crashed, markCrashed, clearCrashed } =
    useWorkspaceItems();
  // feature 018 (T003/T004): first-launch auto-open of the model library.
  // Evaluates once, after model.status hydration, on the first terminal
  // status — never during "loading", never again this session (FR-001/4/6)
  const startupEval = useRef(false);
  const [startupPrompted, setStartupPrompted] = useState(false);
  // feature 022: full-screen setup gate while the bootstrap downloads/
  // loads a model; "skip" dismisses it for the session — the library
  // (models surface) stays the manual fallback
  const [setupSkipped, setSetupSkipped] = useState(false);
  const { state: setupState, retry: retrySetup } = useSetup();
  useEffect(() => {
    const d = decideStartupPrompt({
      hydrated: state.modelStatusHydrated,
      evaluated: startupEval.current,
      status: state.modelStatus,
    });
    if (d === "wait") return;
    startupEval.current = true;
    if (d === "open") {
      select("surface:models");
      setStartupPrompted(true);
    }
    // "settle" (ready) — evaluated latch alone suppresses future prompts
  }, [state.modelStatusHydrated, state.modelStatus]);
  // dismissal = leaving the auto-opened models surface before a model is
  // ready (FR-004); a ready transition just ends the prompted state (T004)
  useEffect(() => {
    if (
      startupPrompted &&
      (selectedId !== "surface:models" || state.modelStatus === "ready")
    ) {
      setStartupPrompted(false);
    }
  }, [selectedId, startupPrompted, state.modelStatus]);
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
    <SidebarProvider className="h-screen bg-background text-foreground">
      <AppSidebar
        conversations={state.conversations}
        activeId={state.conversationId}
        onSelect={(id) => {
          select("chat");
          void selectConversation(id);
        }}
        onNew={() => {
          select("chat");
          newConversation();
        }}
        onRename={(id, t) => void renameConversation(id, t)}
        onDelete={(id) => void deleteConversation(id)}
        onExport={(id, f) => exportConversation(id, f)}
        onImport={async () => {
          const r = await importConversation();
          if (r) select("chat");
          return r;
        }}
        onSelectHit={(cid, mid) => {
          select("chat");
          void selectConversation(cid, mid);
        }}
        workspaceTabs={tabs}
        selectedTabId={selectedId}
        onSelectTab={select}
        crashedTabIds={crashed}
        onCloseTab={(packId) => void invoke("extension.disable", { packId })}
        onOpenLibrary={() => select("surface:models")}
        onOpenPersonas={() => select("surface:personas")}
        onOpenRoles={() => select("surface:roles")}
        onOpenSettings={() => select("surface:settings")}
        onManageExtensions={() => select("surface:extensions")}
      />
      <SidebarInset>
        <header className="flex flex-wrap items-center justify-between gap-x-4 border-b border-border px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger />
            <h1 className="text-sm font-semibold">
              {tabs.find((t) => t.id === selectedId)?.title ?? "Chat"}
            </h1>
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
          <div className="flex min-w-0 items-center gap-1">
            {state.mode === "fusion" ? (
              <>
                <ModelSelector
                  label="Planner"
                  value={state.plannerTag}
                  options={boundTags}
                  onSelect={(t) => void setMode("fusion", t, state.executorTag)}
                  onManage={() => select("surface:roles")}
                  disabled={state.generatingId !== null}
                />
                <ModelSelector
                  label="Executor"
                  value={state.executorTag}
                  options={boundTags}
                  onSelect={(t) => void setMode("fusion", state.plannerTag, t)}
                  onManage={() => select("surface:roles")}
                  disabled={state.generatingId !== null}
                />
              </>
            ) : (
              <ModelSelector
                label="Model"
                value={modelTagName}
                options={boundTags}
                onSelect={(t) => void applyTag(t)}
                onManage={() => select("surface:models")}
                disabled={state.generatingId !== null}
              />
            )}
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
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">
        <WorkspacePanels
          tabs={tabs}
          selectedId={selectedId}
          select={select}
          focusView={focusView}
          focusRunId={focusRun}
          onRunStarted={setFocusRun}
          onOpenPanelView={(packId, viewId) => {
            setOpenView({ packId, viewId, slot: "panel" });
            select("surface:extensions");
          }}
          onCrash={markCrashed}
          onRecovered={clearCrashed}
          chat={
            <>
              <UpdateBanner generating={state.generatingId !== null} />
              {tagOffer && (
                <div className="flex items-center justify-center gap-2 border-b border-border bg-muted px-4 py-2 text-xs">
                  <span>
                    This persona prefers the "{tagOffer}" role — apply it to
                    this conversation?
                  </span>
                  <Button size="sm" onClick={() => void applyTagOffer()}>
                    Apply
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setTagOffer(null)}
                  >
                    Dismiss
                  </Button>
                </div>
              )}
              {state.modelStatus === "unloaded" && (
                <button
                  className="w-full border-b border-border bg-muted px-4 py-2 text-center text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => select("surface:models")}
                >
                  No model is loaded — click to pick a .gguf file to start
                  chatting.
                </button>
              )}
              {state.modelStatus === "error" && (
                <div className="border-b border-border bg-destructive px-4 py-2 text-center text-sm text-destructive">
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
                onUnbound={() => select("surface:roles")}
              />
              {state.notice && (
                <div className="border-b border-border bg-warning/15 px-4 py-2 text-center text-sm text-warning">
                  {state.notice}
                </div>
              )}
              {state.lastError && (
                <div className="border-b border-border bg-destructive px-4 py-2 text-center text-sm text-destructive">
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
              <MessageList
                messages={path}
                variants={variants}
                generating={state.generatingId !== null}
                scrollToId={state.scrollTarget}
                onRegenerate={(id) => void regenerate(id)}
                onEdit={(id, c) => void editMessage(id, c)}
                onSelectVariant={selectVariant}
              />
              <Composer
                generating={state.generatingId !== null}
                modelReady={modelReady}
                snippets={snippets}
                onSend={(c, ids, chips) => void send(c, ids, chips)}
                onStop={stop}
                onPickModel={() => select("surface:models")}
              />
              {/* feature 016: bottom dock — sibling shrinks the message area */}
              <OutputPanel open={metricsOpen} />
            </>
          }
        />
        </div>
        {/* feature 021: app surfaces are full-screen pages — mounted for
            state preservation, shown only when selected (FR-015) */}
        <div
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
          hidden={selectedId !== "surface:models"}
        >
          {/* feature 022: bootstrap progress/errors above the library,
              which remains the manual fallback (spec FR-006) */}
          <SetupPanel />
          <ModelLibrary
            activeName={state.modelName}
            onLoad={(p) => void loadModel(p)}
            autoLoadOnDownload={startupPrompted}
          />
        </div>
        <div
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
          hidden={selectedId !== "surface:personas"}
        >
          <PersonasPanel />
        </div>
        <div
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
          hidden={selectedId !== "surface:roles"}
        >
          <RolesPanel />
        </div>
        <div
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
          hidden={selectedId !== "surface:scripts"}
        >
          <ScriptsPage />
        </div>
        <div
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
          hidden={selectedId !== "surface:settings"}
        >
          <ToolSettings />
          <ScriptsSettings />
          <UpdatesSection />
          <DataPanel />
        </div>
        <div
          className="flex min-h-0 flex-1 flex-col overflow-y-auto"
          hidden={selectedId !== "surface:extensions"}
        >
          <ExtensionsPanel onBrowse={(packId) => setBrowsePack(packId)} />
          {browsePack && (
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
          <RunView focusRunId={focusRun} />
          {openView && (
            <ExtViewHost
              packId={openView.packId}
              viewId={openView.viewId}
              slot={openView.slot}
              onClose={() => setOpenView(null)}
            />
          )}
        </div>
      </SidebarInset>
      {!setupSkipped &&
        (setupState.phase === "downloading" ||
          setupState.phase === "loading" ||
          setupState.phase === "error") && (
          <SetupScreen
            state={setupState}
            onRetry={retrySetup}
            onSkip={() => setSetupSkipped(true)}
          />
        )}
    </SidebarProvider>
  );
}
