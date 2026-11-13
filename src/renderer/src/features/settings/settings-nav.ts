// feature 026 (FR-014): the settings groups and which section is "current"
// while scrolling. Pure so the selection rule is tested.
export interface SettingsItem {
  id: string; // element id of the section
  label: string;
}
export interface SettingsGroup {
  label: string;
  items: SettingsItem[];
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: "Assistant",
    items: [
      { id: "settings-tools", label: "Local tools" },
      { id: "settings-scripts", label: "Python & R scripts" },
    ],
  },
  { label: "Data", items: [{ id: "settings-data", label: "Backup" }] },
  {
    label: "Application",
    items: [
      { id: "settings-updates", label: "Updates" },
      { id: "settings-layout", label: "Layout" },
      { id: "settings-shortcuts", label: "Keyboard shortcuts" },
    ],
  },
];

export const SETTINGS_ORDER: string[] = SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => i.id));

// the current section: the first one (in page order) that is at least
// partly visible; when none is (between sections), keep the previous one
export function pickActive(
  order: string[],
  visible: ReadonlySet<string>,
  previous: string | null,
): string | null {
  for (const id of order) if (visible.has(id)) return id;
  return previous && order.includes(previous) ? previous : (order[0] ?? null);
}
