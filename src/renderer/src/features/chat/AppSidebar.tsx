// feature 021 (US4): sidebar-05 app shell — collapsible nav groups for
// conversations and extensions, plus a footer for app-level surfaces.
// The conversation list itself lives in ConversationNav (ex-Sidebar).
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { isMacPlatform, shortcutLabel } from "@/lib/actions";
import type { ConversationSummary, WorkspaceTab } from "@shared/types";
import { IconChat, IconChevronDown, IconExtension, IconFileCode, IconLibrary, IconSettings, IconTags, IconUsers, IconSearch } from "@/components/icons";
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
} from "@/components/ui/sidebar";
import { ConversationNav } from "./ConversationNav";
import { ThemeSettings } from "../settings/ThemeSettings";
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
  onOpenScripts: () => void;
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
  onOpenScripts,
  onOpenSettings,
  onManageExtensions,
  crashedTabIds,
  onCloseTab,
}: Props) {
  const extTabs = workspaceTabs.filter(
    (t) => t.kind === "ext" || t.kind === "pack",
  );
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
                isActive={selectedTabId === "surface:scripts"}
                tooltip="Python &amp; R scripts"
                onClick={onOpenScripts}
                className="h-8"
              >
                <IconFileCode className="size-4" />
                <span>Scripts</span>
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
