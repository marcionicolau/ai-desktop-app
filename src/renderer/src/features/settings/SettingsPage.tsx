// feature 026 (FR-014): the settings surface — related sections grouped under
// headings, with an in-page navigator that jumps to a section and shows
// which one is on screen.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { pickActive, SETTINGS_GROUPS, SETTINGS_ORDER } from "./settings-nav";

export function SettingsPage({ children }: { children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(SETTINGS_ORDER[0] ?? null);

  // the current section follows the scroll position
  useEffect(() => {
    const root = scroller.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        setActive((prev) => pickActive(SETTINGS_ORDER, visible, prev));
      },
      { root, rootMargin: "0px 0px -60% 0px" },
    );
    for (const id of SETTINGS_ORDER) {
      const el = root.querySelector(`#${id}`);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  const jump = (id: string) => {
    const el = scroller.current?.querySelector<HTMLElement>(`#${id}`);
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    // keyboard users land on the section, not back at the nav
    el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });
    setActive(id);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav
        aria-label="Settings sections"
        className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-border bg-background px-4 py-2"
      >
        {SETTINGS_GROUPS.map((g) => (
          <div key={g.label} className="flex items-center gap-1">
            <span className="mr-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              {g.label}
            </span>
            {g.items.map((it) => (
              <button
                key={it.id}
                type="button"
                aria-current={active === it.id ? "true" : undefined}
                onClick={() => jump(it.id)}
                className={cn(
                  "rounded-md px-2 py-1 text-xs transition-colors hover:bg-accent hover:text-accent-foreground",
                  active === it.id ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground",
                )}
              >
                {it.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div ref={scroller} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
