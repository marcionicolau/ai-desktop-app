// feature 021 (US4): sidebar-05 app shell — collapsible nav groups for
// conversations and extensions, plus a footer for app-level surfaces.
// The conversation list itself lives in ConversationNav (ex-Sidebar).
import type { ConversationSummary, WorkspaceTab } from "@shared/types";
import { MessageSquare, Puzzle } from "lucide-react";
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
import { ChevronDown, Library, Settings2, Tags, Users } from "lucide-react";

interface Props {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string, format: "markdown" | "json") => Promise<string | null>;
  onImport: () => Promise<string | null>;
  onSelectHit: (conversationId: string, messageId: string) => void;
  // workspace accordion items beyond the Chat entry (ext views + packs)
  workspaceTabs: WorkspaceTab[];
  selectedTabId: string;
  onSelectTab: (id: string) => void;
  // panel/surface toggles owned by ChatPage
  onOpenLibrary: () => void;
  onOpenPersonas: () => void;
  onOpenRoles: () => void;
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
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium text-sidebar-foreground/70 outline-none hover:bg-sidebar-accent focus-visible:ring-1 focus-visible:ring-sidebar-ring group-data-[state=collapsed]:hidden">
          {label}
          <ChevronDown className="size-3.5 transition-transform duration-200 group-data-[state=closed]/navgroup:-rotate-90" />
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
  onRename,
  onDelete,
  onExport,
  onImport,
  onSelectHit,
  workspaceTabs,
  selectedTabId,
  onSelectTab,
  onOpenLibrary,
  onOpenPersonas,
  onOpenRoles,
  onOpenSettings,
  onManageExtensions,
}: Props) {
  const extTabs = workspaceTabs.filter((t) => t.kind !== "chat");
  return (
    <Sidebar>
      <SidebarHeader>
        <span className="px-1 text-sm font-semibold group-data-[state=collapsed]:hidden">
          AI Desktop
        </span>
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
            onSelectHit={onSelectHit}
          />
        </NavGroup>
        <NavGroup label="Extensions" defaultOpen>
          <SidebarMenu>
            {extTabs.map((t) => (
              <SidebarMenuItem key={t.id}>
                <SidebarMenuButton
                  isActive={selectedTabId === t.id}
                  tooltip={t.title}
                  onClick={() => onSelectTab(t.id)}
                  className="h-8"
                >
                  {t.kind === "pack" ? (
                    <Puzzle className="size-4" />
                  ) : (
                    <MessageSquare className="size-4" />
                  )}
                  <span className="truncate">{t.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={selectedTabId === "surface:extensions"}
                tooltip="Manage extensions"
                onClick={onManageExtensions}
                className={cn("h-8", extTabs.length === 0 ? "" : "text-muted-foreground")}
              >
                <Settings2 className="size-4" />
                <span>Manage…</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </NavGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Model library" onClick={onOpenLibrary} className="h-8">
              <Library className="size-4" />
              <span>Models</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Personas" onClick={onOpenPersonas} className="h-8">
              <Users className="size-4" />
              <span>Personas</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Model roles" onClick={onOpenRoles} className="h-8">
              <Tags className="size-4" />
              <span>Roles</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Settings" onClick={onOpenSettings} className="h-8">
              <Settings2 className="size-4" />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <ThemeSettings compact={false} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
