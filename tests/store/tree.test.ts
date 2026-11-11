import { describe, expect, test } from "bun:test";
import type { Conversation, Message } from "../../src/shared/types";
import {
  children,
  deepestLeaf,
  leafOf,
  pathOf,
  pathToLeaf,
  siblings,
  variantIndex,
} from "../../src/bun/store/tree";
import { backfillTree } from "../../src/bun/store/json-store";

let seq = 0;
function msg(
  id: string,
  role: Message["role"],
  parentId: string | null = null,
): Message {
  seq += 1;
  return {
    id,
    conversationId: "c1",
    role,
    content: `content-${id}`,
    status: "complete",
    createdAt: `2025-01-01T00:00:${String(seq).padStart(2, "0")}.000Z`,
    completedAt: `2025-01-01T00:00:${String(seq).padStart(2, "0")}.000Z`,
    parentId,
  };
}

function conv(messages: Message[], activeLeaf?: string | null): Conversation {
  return {
    id: "c1",
    title: "t",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    messages,
    mode: "single",
    plannerTag: "planner",
    executorTag: "executor",
    activeLeaf,
  };
}

// tree:
//   u1
//   +-- a1            (regenerate sibling of a2)
//   +-- a2
//        +-- u2
//             +-- a3  (active leaf)
const u1 = msg("u1", "user");
const a1 = msg("a1", "assistant", "u1");
const a2 = msg("a2", "assistant", "u1");
const u2 = msg("u2", "user", "a2");
const a3 = msg("a3", "assistant", "u2");

describe("tree ops", () => {
  const c = conv([u1, a1, a2, u2, a3], "a3");

  test("leafOf resolves activeLeaf; falls back to last message", () => {
    expect(leafOf(c)?.id).toBe("a3");
    expect(leafOf(conv([u1, a1, a2, u2, a3]))?.id).toBe("a3");
    expect(leafOf(conv([]))).toBeNull();
  });

  test("pathOf returns the active path root-first, skipping dead branches", () => {
    expect(pathOf(c).map((m) => m.id)).toEqual(["u1", "a2", "u2", "a3"]);
    // activeLeaf on the other variant flips the path
    const other = conv([u1, a1, a2, u2, a3], "a1");
    expect(pathOf(other).map((m) => m.id)).toEqual(["u1", "a1"]);
  });

  test("siblings groups by parentId in stable createdAt order", () => {
    expect(siblings(c, a1).map((m) => m.id)).toEqual(["a1", "a2"]);
    expect(siblings(c, u1).map((m) => m.id)).toEqual(["u1"]);
    expect(siblings(c, a3).map((m) => m.id)).toEqual(["a3"]);
  });

  test("children returns ordered descendants only", () => {
    expect(children(c, u1).map((m) => m.id)).toEqual(["a1", "a2"]);
    expect(children(c, a1)).toEqual([]);
  });

  test("deepestLeaf follows latest-created children to a leaf", () => {
    expect(deepestLeaf(c, u1).id).toBe("a3");
    expect(deepestLeaf(c, a1).id).toBe("a1");
    expect(deepestLeaf(c, a2).id).toBe("a3");
  });

  test("variantIndex is 1-based inside the variant set", () => {
    expect(variantIndex(c, a1)).toEqual({ pos: 1, total: 2 });
    expect(variantIndex(c, a2)).toEqual({ pos: 2, total: 2 });
    expect(variantIndex(c, a3)).toEqual({ pos: 1, total: 1 });
  });

  test("pathToLeaf is cycle-guarded", () => {
    const loop: Message = { ...a1, id: "loop", parentId: "loop" };
    const bad = conv([u1, loop], "loop");
    expect(pathToLeaf(bad, loop).map((m) => m.id)).toEqual(["loop"]);
  });
});

describe("backfillTree", () => {
  test("linear pre-005 conversation gets a parentId chain + activeLeaf", () => {
    const m1 = { ...u1, parentId: undefined };
    const m2 = { ...a1, parentId: undefined };
    const m3 = { ...u2, parentId: undefined };
    const c = conv([m1, m2, m3]);
    backfillTree(c);
    expect(m1.parentId).toBeNull();
    expect(m2.parentId).toBe("u1");
    expect(m3.parentId).toBe("a1");
    expect(c.activeLeaf).toBe("u2");
    expect(pathOf(c).map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
  });

  test("preserves existing parentId and activeLeaf", () => {
    const c = conv([u1, a1, a2, u2, a3], "a1");
    backfillTree(c);
    expect(c.activeLeaf).toBe("a1");
    expect(a1.parentId).toBe("u1");
  });

  test("empty conversation gets null activeLeaf", () => {
    const c = conv([]);
    backfillTree(c);
    expect(c.activeLeaf).toBeNull();
  });
});
