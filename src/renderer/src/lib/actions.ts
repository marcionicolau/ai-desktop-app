// feature 026 (FR-010): one registry of navigable destinations and common
// actions. The command palette, the global key handler and the settings
// shortcut list all read from here, so a shortcut can never be shown without
// existing (or exist without being shown). Contract: contracts/actions.md.

export type ActionGroup = "action" | "navigate" | "conversation";

export interface Shortcut {
  key: string; // lower-case key, e.g. "k" or ","
  mod?: boolean; // Ctrl on Windows/Linux, Cmd on macOS
  shift?: boolean;
}

export interface ActionDef {
  id: string;
  label: string;
  group: ActionGroup;
  keywords: string[];
  shortcut?: Shortcut;
  // handled elsewhere (e.g. by the sidebar itself): shown in the palette
  // and the shortcut list, but the global key handler must not fire it
  displayOnly?: boolean;
}

export const NAV_SURFACES: { id: string; label: string; keywords: string[] }[] = [
  { id: "chat", label: "Chat", keywords: ["conversation", "messages"] },
  { id: "surface:models", label: "Models", keywords: ["library", "gguf", "download"] },
  { id: "surface:personas", label: "Personas", keywords: ["prompts", "snippets"] },
  { id: "surface:roles", label: "Roles", keywords: ["planner", "executor", "tags", "fusion"] },
  { id: "surface:scripts", label: "Scripts", keywords: ["python", "r", "tools"] },
  { id: "surface:settings", label: "Settings", keywords: ["preferences", "generation", "theme"] },
  { id: "surface:extensions", label: "Extensions", keywords: ["packs", "plugins"] },
];

export const ACTION_DEFS: ActionDef[] = [
  { id: "palette.open", label: "Open command palette", group: "action", keywords: ["search", "commands", "find"], shortcut: { key: "k", mod: true } },
  { id: "chat.new", label: "New chat", group: "action", keywords: ["conversation", "start", "create"], shortcut: { key: "n", mod: true } },
  { id: "model.switch", label: "Switch model…", group: "action", keywords: ["load", "change", "model"], shortcut: { key: "m", mod: true, shift: true } },
  { id: "sidebar.toggle", label: "Toggle sidebar", group: "action", keywords: ["panel", "navigation", "collapse"], shortcut: { key: "b", mod: true }, displayOnly: true },
  { id: "theme.toggle", label: "Toggle light/dark theme", group: "action", keywords: ["appearance", "dark", "light", "mode"] },
  { id: "layout.reset", label: "Reset panel layout", group: "action", keywords: ["sizes", "sidebar", "metrics", "resize", "default"] },
  { id: "settings.open", label: "Open settings", group: "action", keywords: ["preferences", "options"], shortcut: { key: ",", mod: true } },
  ...NAV_SURFACES.map<ActionDef>((s) => ({
    id: `nav:${s.id}`,
    label: `Go to ${s.label}`,
    group: "navigate",
    keywords: s.keywords,
  })),
];

export interface ActionContext {
  select(id: string): void;
  newChat(): void;
  toggleTheme(): void;
  resetLayout(): void;
  openPalette(initialQuery?: string): void;
  generating: boolean;
}

export type Availability = { ok: true } | { ok: false; reason: string };

export interface ActionEntry extends ActionDef {
  run(): void;
  available(): Availability;
}

const OK: Availability = { ok: true };

export function buildActions(ctx: ActionContext): ActionEntry[] {
  const behaviour: Record<string, { run(): void; available?(): Availability }> = {
    "palette.open": { run: () => ctx.openPalette() },
    "chat.new": { run: () => ctx.newChat() },
    "model.switch": {
      run: () => ctx.openPalette("Use "),
      available: () =>
        ctx.generating
          ? { ok: false, reason: "A reply is being generated — stop it or wait" }
          : OK,
    },
    "sidebar.toggle": { run: () => {} },
    "theme.toggle": { run: () => ctx.toggleTheme() },
    "layout.reset": { run: () => ctx.resetLayout() },
    "settings.open": { run: () => ctx.select("surface:settings") },
  };
  return ACTION_DEFS.map((def) => {
    const nav = def.id.startsWith("nav:") ? def.id.slice(4) : null;
    const b = nav
      ? { run: () => ctx.select(nav), available: undefined }
      : (behaviour[def.id] ?? { run: () => {} });
    return { ...def, run: b.run, available: b.available ?? (() => OK) };
  });
}

// ---- shortcuts -----------------------------------------------------------

export const isMacPlatform = (): boolean =>
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform ?? "");

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function matchesShortcut(e: KeyLike, s: Shortcut, mac: boolean): boolean {
  const modDown = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!!s.mod !== modDown) return false;
  if (!!s.shift !== e.shiftKey) return false;
  if (e.altKey) return false;
  return e.key.toLowerCase() === s.key;
}

export function shortcutLabel(s: Shortcut, mac: boolean): string {
  const key = s.key.length === 1 ? s.key.toUpperCase() : s.key;
  if (mac) return `${s.shift ? "⇧" : ""}${s.mod ? "⌘" : ""}${key}`;
  return [s.mod ? "Ctrl" : null, s.shift ? "Shift" : null, key].filter(Boolean).join("+");
}

// the action a key event triggers, if any (displayOnly entries never match)
export function actionForKey(
  e: KeyLike,
  actions: ActionEntry[],
  mac: boolean,
): ActionEntry | null {
  for (const a of actions) {
    if (a.displayOnly || !a.shortcut) continue;
    if (matchesShortcut(e, a.shortcut, mac)) return a;
  }
  return null;
}
