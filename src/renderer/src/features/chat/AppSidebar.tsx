// feature 021 (US4): sidebar-05 app shell — collapsible nav groups for
// conversations and extensions, plus a footer for app-level surfaces.
// The conversation list itself lives in ConversationNav (ex-Sidebar).
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { isMacPlatform, shortcutLabel } from "@/lib/actions";
import type { ConversationSummary, WorkspaceTab } from "@shared/types";
import { IconChat, IconChevronDown, IconExtension, IconFileCode, IconLibrary, IconLink, IconSettings, IconTags, IconUsers, IconSearch, IconWarning } from "@/components/icons";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { ConversationNav } from "./ConversationNav";
import { ThemeSettings } from "../settings/ThemeSettings";
import { useScripts } from "../scripts/use-scripts";
import { groupScripts } from "../scripts/scripts-groups";
import { cn } from "@/lib/utils";

interface Props {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onOpenPalette: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string, format: "markdown" | "json") => Promise<string | null>;
  onImport: () => Promise<string | null>;
  // workspace panel items beyond the Chat entry (ext views + packs)
  workspaceTabs: WorkspaceTab[];
  selectedTabId: string;
  onSelectTab: (id: string) => void;
  // tab chrome for ext/pack items — crash badge + hover × (disable pack)
  crashedTabIds?: ReadonlySet<string>;
  onCloseTab?: (packId: string) => void;
  // panel/surface toggles owned by ChatPage
  onOpenLibrary: () => void;
  onOpenPersonas: () => void;
  onOpenRoles: () => void;
  // feature 027 (US1): scripts workspace — per-script selection + actions
  selectedScriptId: string | null;
  onSelectScript: (id: string) => void;
  onNewScript: () => void;
  onImportScripts: () => void;
  onOpenSettings: () => void;
  onManageExtensions: () => void;
}

function NavGroup({
  label,
  defaultOpen,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="group/navgroup">
      <SidebarGroup className="p-0">
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium text-sidebar-foreground/70 outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[state=collapsed]:hidden">
          {label}
          <IconChevronDown className="size-3.5 transition-transform duration-200 group-data-[state=closed]/navgroup:-rotate-90" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarGroupContent>{children}</SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}

export function AppSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onOpenPalette,
  onRename,
  onDelete,
  onExport,
  onImport,
  workspaceTabs,
  selectedTabId,
  onSelectTab,
  onOpenLibrary,
  onOpenPersonas,
  onOpenRoles,
  selectedScriptId,
  onSelectScript,
  onNewScript,
  onImportScripts,
  onOpenSettings,
  onManageExtensions,
  crashedTabIds,
  onCloseTab,
}: Props) {
  const { scripts } = useScripts();
  const scriptGroups = groupScripts(scripts);
  const extTabs = workspaceTabs.filter(
    (t) => t.kind === "ext" || t.kind === "pack",
  );

  // FR-015: fold to the icon rail on compact windows. The collapse applies
  // once per crossing, so a manual re-expand at the same width is kept
  // until the window is widened and narrowed again.
  const { setOpen } = useSidebar();
  const autoRail = useRef(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 896px)");
    const apply = () => {
      if (mq.matches) {
        if (!autoRail.current) {
          autoRail.current = true;
          setOpen(false);
        }
      } else {
        autoRail.current = false;
      }
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [setOpen]);

  return (
    <Sidebar>
      <SidebarHeader>
        <span className="px-1 text-sm font-semibold group-data-[state=collapsed]:hidden">
          AI Desktop
        </span>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground group-data-[state=collapsed]:hidden"
          onClick={onOpenPalette}
          aria-label="Open command palette"
        >
          <IconSearch aria-hidden="true" /> Search &amp; commands
          <Kbd className="ml-auto">
            {shortcutLabel({ key: "k", mod: true }, isMacPlatform())}
          </Kbd>
        </Button>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label="Chats" defaultOpen>
          <ConversationNav
            conversations={conversations}
            activeId={activeId}
            onSelect={onSelect}
            onNew={onNew}
            onRename={onRename}
            onDelete={onDelete}
            onExport={onExport}
            onImport={onImport}
          />
        </NavGroup>
        <NavGroup label="Extensions" defaultOpen>
          <SidebarMenu>
            {extTabs.map((t) => {
              const isCrashed = crashedTabIds?.has(t.id) ?? false;
              return (
                <SidebarMenuItem key={t.id}>
                  <SidebarMenuButton
                    isActive={selectedTabId === t.id}
                    tooltip={isCrashed ? `${t.title} (view crashed)` : t.title}
                    onClick={() => onSelectTab(t.id)}
                    className={cn("h-8", isCrashed && "text-warning")}
                  >
                    {isCrashed ? (
                      <span className="size-1.5 shrink-0 rounded-full bg-warning" />
                    ) : t.kind === "pack" ? (
                      <IconExtension className="size-4" />
                    ) : (
                      <IconChat className="size-4" />
                    )}
                    <span className="truncate">{t.title}</span>
                  </SidebarMenuButton>
                  {onCloseTab && (
                    <button
                      aria-label={`Disable ${t.title}`}
                      title="Disable pack"
                      className="absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded px-1 leading-none text-muted-foreground opacity-0 hover:bg-sidebar-accent hover:text-foreground group-hover/menu-item:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseTab(t.packId);
                      }}
                    >
                      ×
                    </button>
                  )}
                </SidebarMenuItem>
              );
            })}
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={selectedTabId === "surface:extensions"}
                tooltip="Manage extensions"
                onClick={onManageExtensions}
                className={cn("h-8", extTabs.length === 0 ? "" : "text-muted-foreground")}
              >
                <IconSettings className="size-4" />
                <span>Manage…</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </NavGroup>
        <NavGroup label="Scripts" defaultOpen>
          <SidebarMenu>
            {scriptGroups.map((g) => (
              <Collapsible key={g.runtime} defaultOpen className="group/lang">
                <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-sidebar-foreground/70 outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[state=collapsed]:hidden">
                  <IconChevronDown className="size-3.5 transition-transform group-data-[state=closed]/lang:-rotate-90" />
                  <span className="flex-1 text-left">
                    {g.label} ({g.count})
                  </span>
                  {g.runtimeMissing && (
                    <span title="Runtime missing — no interpreter found" className="text-warning">
                      <IconWarning className="size-3.5" />
                    </span>
                  )}
                </CollapsibleTrigger>
                <CollapsibleContent className="group-data-[state=collapsed]:hidden">
                  <SidebarMenu className="pl-4">
                    {g.rows.map((s) => (
                      <SidebarMenuItem key={s.id}>
                        <SidebarMenuButton
                          isActive={
                            selectedTabId === "surface:scripts" &&
                            selectedScriptId === s.id
                          }
                          tooltip={
                            s.runtimeStatus === "missing"
                              ? `${s.id} — ${g.label} runtime missing`
                              : s.id
                          }
                          onClick={() => onSelectScript(s.id)}
                          className={cn("h-7", !s.enabled && "text-muted-foreground")}
                        >
                          {s.sourceState === "missing" ? (
                            <IconWarning className="size-3.5 shrink-0 text-warning" />
                          ) : s.linked ? (
                            <IconLink className="size-3.5 shrink-0" />
                          ) : (
                            <IconFileCode className="size-3.5 shrink-0" />
                          )}
                          <span className="truncate font-mono text-xs">{s.id}</span>
                          {!s.enabled && (
                            <span className="ml-auto text-xs text-muted-foreground">off</span>
                          )}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </CollapsibleContent>
              </Collapsible>
            ))}
            {scripts.length === 0 && (
              <SidebarMenuItem>
                <span className="px-2 py-1 text-xs text-muted-foreground group-data-[state=collapsed]:hidden">
                  No scripts yet
                </span>
              </SidebarMenuItem>
            )}
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="New script"
                onClick={onNewScript}
                className="h-7 text-muted-foreground"
              >
                <IconFileCode className="size-3.5" />
                <span className="text-xs">New script</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Import .py/.r files"
                onClick={onImportScripts}
                className="h-7 text-muted-foreground"
              >
                <IconLink className="size-3.5" />
                <span className="text-xs">Import from file…</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Interpreter paths (Settings)"
                onClick={onOpenSettings}
                className="h-7 text-muted-foreground"
              >
                <IconSettings className="size-3.5" />
                <span className="text-xs">Runtime paths…</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </NavGroup>
        <NavGroup label="Configurations" defaultOpen>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={selectedTabId === "surface:models"}
                tooltip="Model library"
                onClick={onOpenLibrary}
                className="h-8"
              >
                <IconLibrary className="size-4" />
                <span>Models</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={selectedTabId === "surface:personas"}
                tooltip="Personas"
                onClick={onOpenPersonas}
                className="h-8"
              >
                <IconUsers className="size-4" />
                <span>Personas</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={selectedTabId === "surface:roles"}
                tooltip="Model roles"
                onClick={onOpenRoles}
                className="h-8"
              >
                <IconTags className="size-4" />
                <span>Roles</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={selectedTabId === "surface:settings"}
                tooltip="Settings"
                onClick={onOpenSettings}
                className="h-8"
              >
                <IconSettings className="size-4" />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </NavGroup>
      </SidebarContent>
      <SidebarFooter>
        <ThemeSettings compact={false} />
      </SidebarFooter>
    </Sidebar>
  );
}
