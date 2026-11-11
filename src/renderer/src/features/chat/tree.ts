// Client-side mirror of src/bun/store/tree.ts (feature 005): the
// renderer keeps the flat messages[] + activeLeaf and derives the
// displayed path + variant sets locally (<100 ms switches, no RPC per
// click). Operates on (messages, activeLeaf) since drafts have no
// persisted Conversation.
import type { Message } from "@shared/types";

const variantOrder = (messages: Message[]) => {
  const idx = new Map(messages.map((m, i) => [m.id, i]));
  return (a: Message, b: Message) =>
    a.createdAt.localeCompare(b.createdAt) ||
    (idx.get(a.id) ?? 0) - (idx.get(b.id) ?? 0);
};

export function childrenOf(messages: Message[], m: Message): Message[] {
  return messages.filter((x) => x.parentId === m.id).toSorted(variantOrder(messages));
}

export function siblingsOf(messages: Message[], m: Message): Message[] {
  const pid = m.parentId ?? null;
  return messages
    .filter((x) => (x.parentId ?? null) === pid)
    .toSorted(variantOrder(messages));
}

export function leafOf(messages: Message[], activeLeaf: string | null): Message | null {
  if (activeLeaf != null) {
    const leaf = messages.find((m) => m.id === activeLeaf);
    if (leaf) return leaf;
  }
  return messages.at(-1) ?? null;
}

export function pathToLeaf(messages: Message[], from: Message): Message[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const out: Message[] = [];
  const seen = new Set<string>();
  let cur: Message | undefined = from;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    cur = cur.parentId != null ? byId.get(cur.parentId) : undefined;
  }
  return out.toReversed();
}

// displayed path: ancestors of the active leaf, root-first
export function pathOf(messages: Message[], activeLeaf: string | null): Message[] {
  const leaf = leafOf(messages, activeLeaf);
  return leaf ? pathToLeaf(messages, leaf) : [];
}

export function deepestLeaf(messages: Message[], m: Message): Message {
  let cur = m;
  for (;;) {
    const kids = childrenOf(messages, cur);
    if (kids.length === 0) return cur;
    cur = kids.at(-1)!;
  }
}

// variant nav data for every message that has siblings:
// id -> ordered sibling ids + 1-based position
export function variantInfo(
  messages: Message[],
): Map<string, { pos: number; ids: string[] }> {
  const groups = new Map<string | null, Message[]>();
  const order = variantOrder(messages);
  for (const m of messages) {
    const key = m.parentId ?? null;
    const g = groups.get(key);
    if (g) g.push(m);
    else groups.set(key, [m]);
  }
  const out = new Map<string, { pos: number; ids: string[] }>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = group.toSorted(order);
    const ids = sorted.map((m) => m.id);
    sorted.forEach((m, i) => out.set(m.id, { pos: i + 1, ids }));
  }
  return out;
}

// branch points for the overview: parentId -> children (>=2)
export function branchPoints(
  messages: Message[],
): { parentId: string | null; variants: Message[] }[] {
  const groups = new Map<string | null, Message[]>();
  const order = variantOrder(messages);
  for (const m of messages) {
    const key = m.parentId ?? null;
    const g = groups.get(key);
    if (g) g.push(m);
    else groups.set(key, [m]);
  }
  return [...groups.entries()]
    .filter(([, v]) => v.length > 1)
    .map(([parentId, variants]) => ({
      parentId,
      variants: [...variants].toSorted(order),
    }));
}
