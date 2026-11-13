import * as React from "react";
import { IconSidebar } from "@/components/icons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Vendored shadcn `ui/sidebar` — reduced for this desktop app:
 * icon-rail collapse only (no offcanvas Sheet), localStorage persistence,
 * Ctrl/Cmd+B toggle. Widths follow shadcn: 16rem expanded, 3rem rail.
 */

const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_ICON = "3rem";
const STORAGE_KEY = "sidebar:state";

type SidebarState = "expanded" | "collapsed";

interface SidebarCtx {
  state: SidebarState;
  open: boolean;
  setOpen: (v: boolean | ((v: boolean) => boolean)) => void;
  toggle: () => void;
}

const Ctx = React.createContext<SidebarCtx | null>(null);

export function useSidebar(): SidebarCtx {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useSidebar must be used inside <SidebarProvider>");
  return ctx;
}

export function SidebarProvider({
  defaultOpen = true,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & { defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState<boolean>(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v === null ? defaultOpen : v === "true";
    } catch {
      return defaultOpen;
    }
  });

  const setOpenPersist = React.useCallback(
    (v: boolean | ((v: boolean) => boolean)) => {
      setOpen((prev) => {
        const next = typeof v === "function" ? v(prev) : v;
        try {
          localStorage.setItem(STORAGE_KEY, String(next));
        } catch {
          /* private mode */
        }
        return next;
      });
    },
    [],
  );

  const toggle = React.useCallback(() => setOpenPersist((v) => !v), [setOpenPersist]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const value = React.useMemo<SidebarCtx>(
    () => ({ state: open ? "expanded" : "collapsed", open, setOpen: setOpenPersist, toggle }),
    [open, setOpenPersist, toggle],
  );

  return (
    <Ctx.Provider value={value}>
      {/* Radix Tooltip throws without a provider — collapsed-state button
          tooltips render under us, so the provider must live here */}
      <TooltipProvider delayDuration={0}>
      <div
        data-slot="sidebar-wrapper"
        className={cn("group/sidebar-wrapper flex h-full min-h-0 w-full", className)}
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
            ...style,
          } as React.CSSProperties
        }
        {...props}
      >
        {children}
      </div>
      </TooltipProvider>
    </Ctx.Provider>
  );
}

export function Sidebar({
  className,
  children,
  ...props
}: React.ComponentProps<"aside">) {
  const { state } = useSidebar();
  return (
    <aside
      data-slot="sidebar"
      data-state={state}
      className={cn(
        "group flex h-full w-(--sidebar-width) shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-linear overflow-hidden",
        "data-[state=collapsed]:w-(--sidebar-width-icon)",
        className,
      )}
      {...props}
    >
      {children}
    </aside>
  );
}

export function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn("relative flex min-w-0 flex-1 flex-col", className)}
      {...props}
    />
  );
}

export function SidebarTrigger({ className, onClick, ...props }: React.ComponentProps<typeof Button>) {
  const { toggle } = useSidebar();
  return (
    <Button
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon"
      aria-label="Toggle sidebar"
      title="Toggle sidebar (Ctrl+B)"
      className={cn("h-7 w-7", className)}
      onClick={(e) => {
        onClick?.(e);
        toggle();
      }}
      {...props}
    >
      <IconSidebar className="h-4 w-4" />
    </Button>
  );
}

export function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-header" className={cn("flex flex-col gap-2 p-2", className)} {...props} />;
}

export function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-footer" className={cn("mt-auto flex flex-col gap-1 p-2", className)} {...props} />;
}

export function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn("flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden p-1", className)}
      {...props}
    />
  );
}

export function SidebarSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return <Separator data-slot="sidebar-separator" className={cn("mx-2 w-auto bg-sidebar-border", className)} {...props} />;
}

export function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-group" className={cn("relative flex w-full min-w-0 flex-col", className)} {...props} />;
}

export function SidebarGroupLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-label"
      className={cn(
        "flex h-7 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70",
        "group-data-[state=collapsed]:hidden",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarGroupContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sidebar-group-content" className={cn("w-full text-sm", className)} {...props} />;
}

export function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return <ul data-slot="sidebar-menu" className={cn("flex w-full min-w-0 flex-col gap-0.5 px-1", className)} {...props} />;
}

export function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li data-slot="sidebar-menu-item" className={cn("group/menu-item relative", className)} {...props} />;
}

export function SidebarMenuButton({
  className,
  isActive,
  tooltip,
  children,
  ...props
}: React.ComponentProps<"button"> & { isActive?: boolean; tooltip?: string }) {
  const { state } = useSidebar();
  const btn = (
    <button
      type="button"
      data-slot="sidebar-menu-button"
      data-active={isActive}
      className={cn(
        "flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        "data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground",
        state === "collapsed" && "justify-center p-2 [&>span:last-child]:hidden",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
  if (state === "collapsed" && tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{btn}</TooltipTrigger>
        <TooltipContent side="right">{tooltip}</TooltipContent>
      </Tooltip>
    );
  }
  return btn;
}

export function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      className={cn(
        "ml-3.5 flex min-w-0 flex-col gap-0.5 border-l border-sidebar-border pl-2.5",
        "group-data-[state=collapsed]:hidden",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarMenuSubItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li data-slot="sidebar-menu-sub-item" className={cn("relative", className)} {...props} />;
}

export function SidebarMenuSubButton({
  className,
  isActive,
  ...props
}: React.ComponentProps<"button"> & { isActive?: boolean }) {
  return (
    <button
      type="button"
      data-slot="sidebar-menu-sub-button"
      data-active={isActive}
      className={cn(
        "flex w-full items-center gap-2 overflow-hidden rounded-md px-2 py-1 text-left text-sm outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        "data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground",
        className,
      )}
      {...props}
    />
  );
}
