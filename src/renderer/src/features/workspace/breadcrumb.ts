// feature 026 (FR-012): where the user is, as parent › current. Pure so the
// mapping is unit-tested; ChatPage renders it with the Breadcrumb primitives.
export interface Crumbs {
  parent: string;
  current: string;
}

export function breadcrumbFor(opts: {
  selectedId: string;
  tabTitle?: string; // title of the selected workspace item, when known
  conversationTitle?: string; // active conversation, for the chat surface
  // feature 027 (FR-007): Scripts › language › script name
  script?: { id: string; runtime: "python" | "r" };
}): Crumbs {
  const { selectedId, tabTitle, conversationTitle, script } = opts;
  if (selectedId === "chat") {
    return { parent: "Chats", current: conversationTitle?.trim() || "New chat" };
  }
  if (selectedId === "surface:extensions") {
    return { parent: "Extensions", current: "Manage" };
  }
  if (selectedId === "surface:scripts") {
    return {
      parent: "Scripts",
      current: script
        ? `${script.runtime === "python" ? "Python" : "R"} › ${script.id}`
        : "Scripts",
    };
  }
  if (selectedId.startsWith("surface:")) {
    return { parent: "Configurations", current: tabTitle ?? selectedId.slice(8) };
  }
  // extension tab views and pack browsers
  return { parent: "Extensions", current: tabTitle ?? "Extension" };
}
