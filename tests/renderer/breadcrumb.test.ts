import { describe, expect, test } from "bun:test";
import { breadcrumbFor } from "../../src/renderer/src/features/workspace/breadcrumb";

describe("breadcrumbFor", () => {
  test("chat shows the conversation title, or New chat when untitled", () => {
    expect(breadcrumbFor({ selectedId: "chat", conversationTitle: "Release notes" })).toEqual({
      parent: "Chats",
      current: "Release notes",
    });
    expect(breadcrumbFor({ selectedId: "chat", conversationTitle: "  " }).current).toBe("New chat");
    expect(breadcrumbFor({ selectedId: "chat" }).current).toBe("New chat");
  });

  test("configuration surfaces sit under Configurations", () => {
    expect(breadcrumbFor({ selectedId: "surface:models", tabTitle: "Models" })).toEqual({
      parent: "Configurations",
      current: "Models",
    });
    expect(breadcrumbFor({ selectedId: "surface:settings", tabTitle: "Settings" }).parent).toBe("Configurations");
  });

  test("extensions management and extension tabs sit under Extensions", () => {
    expect(breadcrumbFor({ selectedId: "surface:extensions", tabTitle: "Extensions" })).toEqual({
      parent: "Extensions",
      current: "Manage",
    });
    expect(breadcrumbFor({ selectedId: "ext:acme:board", tabTitle: "Board" })).toEqual({
      parent: "Extensions",
      current: "Board",
    });
  });
});
