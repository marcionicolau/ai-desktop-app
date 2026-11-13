import { toggleDensity, useDensity } from "@/lib/density";
import { SettingsPage } from "../settings/SettingsPage";
import { LayoutSection } from "../settings/LayoutSection";
import { resetLayout } from "@/lib/layout";
import { ChatColumn } from "./ChatColumn";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { breadcrumbFor } from "../workspace/breadcrumb";
import { ShortcutsSection } from "../settings/ShortcutsSection";
import { CommandPalette } from "../command/CommandPalette";
import { buildActions } from "@/lib/actions";
import { useGlobalShortcuts } from "@/lib/shortcuts";
import { setThemeMode, useTheme } from "@/lib/theme";
import { confirm } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { IconError, IconWarning } from "@/components/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconBranch } from "@/components/icons";
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
import { ChatSetup } from "./ChatSetup";
import { unboundRoles } from "./chat-setup";
import { Switch } from "@/components/ui/switch";
import { PersonasPanel } from "../personas/PersonasPanel";
import { ScriptDetail } from "../scripts/ScriptDetail";
import { ImportScriptsDialog } from "../scripts/ImportScriptsDialog";
import { useScripts } from "../scripts/use-scripts";
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
  // recovery target for the "last message failed" alert (FR-002)
  const lastAssistant = [...path].reverse().find((m) => m.role === "assistant");
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
  // errors from changing mode/models are shown as one inline alert (FR-023)
  const [setupError, setSetupError] = useState<string | null>(null);
  useEffect(() => setSetupError(null), [state.mode, state.plannerTag, state.executorTag]);
  const unbound = unboundRoles(
    state.mode,
    state.plannerTag,
    state.executorTag,
    boundTags.map((t) => t.id),
  );
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
  // feature 026: command palette + global shortcuts over one action registry
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const openPalette = (q = "") => {
    setPaletteQuery(q);
    setPaletteOpen(true);
  };
  const { resolved: resolvedTheme } = useTheme();
  useDensity(); // applies the saved density at startup
  const actions = useMemo(
    () =>
      buildActions({
        select,
        newChat: () => {
          select("chat");
          newConversation();
        },
        toggleTheme: () => setThemeMode(resolvedTheme === "dark" ? "light" : "dark"),
        toggleDensity,
        resetLayout: () => {
          resetLayout();
          notify.success("Panel layout reset");
        },
        openPalette,
        generating: state.generatingId !== null,
      }),
    [select, newConversation, resolvedTheme, state.generatingId],
  );
  useGlobalShortcuts(actions, (reason) => notify.info(reason));

  // feature 027 (US1): which script the workspace surface shows
  const { scripts } = useScripts();
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const openScript = (id: string | null) => {
    setSelectedScriptId(id);
    select("surface:scripts");
  };

  const crumbs = breadcrumbFor({
    selectedId,
    tabTitle: tabs.find((t) => t.id === selectedId)?.title,
    script: selectedScriptId
      ? scripts.find((s) => s.id === selectedScriptId)
      : undefined,
    conversationTitle: state.conversations.find((c) => c.id === state.conversationId)?.title,
  });

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
        onOpenPalette={() => openPalette()}
        onRename={(id, t) => void renameConversation(id, t)}
        onDelete={(id) => {
          const c = state.conversations.find((x) => x.id === id);
          void (async () => {
            const ok = await confirm({
              title: "Delete conversation",
              itemName: c?.title || "Untitled chat",
              consequence: "Its messages and attachments are removed permanently.",
            });
            if (!ok) return;
            try {
              await deleteConversation(id);
              notify.success("Conversation deleted");
            } catch (e) {
              notify.error("Could not delete the conversation", {
                description: e instanceof Error ? e.message : String(e),
                action: { label: "Retry", run: () => void deleteConversation(id) },
              });
            }
          })();
        }}
        onExport={async (id, f) => {
          try {
            const path = await exportConversation(id, f);
            if (path) notify.success("Conversation exported", { description: path });
            return path;
          } catch (e) {
            notify.error("Export failed", {
              description: e instanceof Error ? e.message : String(e),
              action: { label: "Retry", run: () => void exportConversation(id, f) },
            });
            return null;
          }
        }}
        onImport={async () => {
          try {
            const r = await importConversation();
            if (r) {
              select("chat");
              notify.success("Conversation imported");
            }
            return r;
          } catch (e) {
            notify.error("Import failed", {
              description: e instanceof Error ? e.message : String(e),
            });
            return null;
          }
        }}
        workspaceTabs={tabs}
        selectedTabId={selectedId}
        onSelectTab={select}
        crashedTabIds={crashed}
        onCloseTab={(packId) => void invoke("extension.disable", { packId })}
        onOpenLibrary={() => select("surface:models")}
        onOpenPersonas={() => select("surface:personas")}
        onOpenRoles={() => select("surface:roles")}
        selectedScriptId={selectedScriptId}
        onSelectScript={(id) => openScript(id)}
        onNewScript={() => openScript("__new__")}
        onImportScripts={() => setImportOpen(true)}
        onOpenSettings={() => select("surface:settings")}
        onManageExtensions={() => select("surface:extensions")}
      />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        initialQuery={paletteQuery}
        actions={actions}
        conversations={state.conversations}
        models={boundTags}
        onUseModel={(tag) =>
          void (state.mode === "fusion"
            ? setMode("fusion", state.plannerTag, tag)
            : applyTag(tag))
        }
        onSelectConversation={(id, mid) => {
          select("chat");
          void selectConversation(id, mid);
        }}
        scripts={scripts}
        onSelectScript={(id) => openScript(id)}
      />
      <SidebarInset>
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-border px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <SidebarTrigger />
            <Breadcrumb>
              <BreadcrumbList className="flex-nowrap text-sm">
                <BreadcrumbItem className="hidden sm:inline-flex">{crumbs.parent}</BreadcrumbItem>
                <BreadcrumbSeparator className="hidden sm:block" />
                <BreadcrumbItem className="min-w-0">
                  <h1 className="contents">
                    <BreadcrumbPage className="max-w-[16rem] truncate font-semibold" title={crumbs.current}>
                      {crumbs.current}
                    </BreadcrumbPage>
                  </h1>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {/* feature 026 (FR-023): mode, models and persona live here only */}
            <ChatSetup
              mode={state.mode}
              plannerTag={state.plannerTag}
              executorTag={state.executorTag}
              modelTagName={modelTagName}
              boundTags={boundTags}
              personas={personas}
              personaName={state.personaName ?? null}
              generating={state.generatingId !== null}
              onSetMode={setMode}
              onApplyTag={applyTag}
              onPersona={onPersona}
              onManageRoles={() => select("surface:roles")}
              onManageModels={() => select("surface:models")}
              onError={setSetupError}
              onUnbound={() => select("surface:roles")}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Branches"
              title="Branches"
              disabled={branches.length === 0}
              onClick={() => setBranchesOpen((v) => !v)}
            >
              <IconBranch className="h-4 w-4" />
            </Button>
            <label htmlFor="metrics-switch" className="flex cursor-pointer items-center gap-1.5 text-xs">
              <Switch
                id="metrics-switch"
                checked={metricsOpen}
                onCheckedChange={(v) => void toggleMetrics(v)}
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
            <ChatColumn metricsOpen={metricsOpen} metrics={<OutputPanel open />}>
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
                <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
                  <IconError aria-hidden="true" />
                  <AlertTitle>Model failed to load</AlertTitle>
                  <AlertDescription className="flex flex-wrap items-center gap-2">
                    {state.modelError ?? "The model could not be started."}
                    <Button size="sm" variant="outline" onClick={() => select("surface:models")}>
                      Open Models
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              {(setupError || unbound.length > 0) && (
                <Alert
                  variant={setupError ? "destructive" : "default"}
                  className="rounded-none border-x-0 border-t-0"
                >
                  {setupError ? <IconError aria-hidden="true" /> : <IconWarning aria-hidden="true" />}
                  <AlertTitle>
                    {setupError ? "The change could not be applied" : "Fusion needs both roles bound"}
                  </AlertTitle>
                  <AlertDescription className="flex flex-wrap items-center gap-2">
                    {setupError ??
                      `Bind ${unbound.join(" and ")} to a model in the Roles panel to use planner + executor.`}
                    <Button size="sm" variant="outline" onClick={() => select("surface:roles")}>
                      Open Roles
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              {state.notice && (
                <div className="border-b border-border bg-warning/15 px-4 py-2 text-center text-sm text-warning">
                  {state.notice}
                </div>
              )}
              {state.lastError && (
                <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
                  <IconError aria-hidden="true" />
                  <AlertTitle>The last message failed</AlertTitle>
                  <AlertDescription className="flex flex-wrap items-center gap-2">
                    <span>
                      {state.lastError.message}{" "}
                      <span className="text-xs opacity-80">({state.lastError.code})</span>
                    </span>
                    {lastAssistant && state.generatingId === null && (
                      <Button size="sm" variant="outline" onClick={() => void regenerate(lastAssistant.id)}>
                        Retry
                      </Button>
                    )}
                  </AlertDescription>
                </Alert>
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
            </ChatColumn>
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
          <ScriptDetail
            scriptId={selectedScriptId}
            onNew={() => openScript(null)}
            onImport={() => setImportOpen(true)}
            onOpenRuntimeSettings={() => select("surface:settings")}
          />
          <ImportScriptsDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            onImported={() => select("surface:scripts")}
          />
        </div>
        <div
          className="flex min-h-0 flex-1 flex-col"
          hidden={selectedId !== "surface:settings"}
        >
          <SettingsPage>
            <ToolSettings />
            <ScriptsSettings />
            <DataPanel />
            <UpdatesSection />
            <LayoutSection />
            <ShortcutsSection />
          </SettingsPage>
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
