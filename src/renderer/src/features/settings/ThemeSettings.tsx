import { IconDark, IconLight, IconSystem } from "@/components/icons";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setThemeMode, useTheme } from "@/lib/theme";
import type { ThemeMode } from "../../../../shared/types";

const MODES: { id: ThemeMode; label: string; icon: typeof IconLight }[] = [
  { id: "light", label: "Light", icon: IconLight },
  { id: "dark", label: "Dark", icon: IconDark },
  { id: "system", label: "System", icon: IconSystem },
];

// feature 021 (FR-009): persisted theme control — light/dark/system.
// Rendered as a compact icon button (sidebar footer) or a labeled row.
export function ThemeSettings({ compact }: { compact?: boolean }) {
  const { themeMode } = useTheme();
  const Current = MODES.find((m) => m.id === themeMode) ?? MODES[2]!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-2 rounded-md p-2 text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring",
            compact ? "justify-center" : "w-full text-left group-data-[state=collapsed]:justify-center",
          )}
          aria-label="Theme"
          title={`Theme: ${Current.label}`}
        >
          <Current.icon className="size-4 shrink-0" />
          {!compact && (
            <span className="group-data-[state=collapsed]:hidden">
              Theme: {Current.label}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-36">
        <DropdownMenuLabel className="text-xs">Theme</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {MODES.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onSelect={() => setThemeMode(m.id)}
            className={cn(themeMode === m.id && "bg-accent")}
          >
            <m.icon className="size-4" />
            {m.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
