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
}): Crumbs {
  const { selectedId, tabTitle, conversationTitle } = opts;
  if (selectedId === "chat") {
    return { parent: "Chats", current: conversationTitle?.trim() || "New chat" };
  }
  if (selectedId === "surface:extensions") {
    return { parent: "Extensions", current: "Manage" };
  }
  if (selectedId.startsWith("surface:")) {
    return { parent: "Configurations", current: tabTitle ?? selectedId.slice(8) };
  }
  // extension tab views and pack browsers
  return { parent: "Extensions", current: tabTitle ?? "Extension" };
}
