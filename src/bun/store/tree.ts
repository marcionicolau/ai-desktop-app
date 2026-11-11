// Pure tree operations over a conversation's flat append-only messages[]
// (feature 005). A variant set = messages sharing the same parentId; the
// displayed path walks ancestors up from Conversation.activeLeaf.
// No I/O — the store calls these after load / before save.
import type { Conversation, Message } from "../../shared/types";

const byId = (conv: Conversation) => {
  const map = new Map<string, Message>();
  for (const m of conv.messages) map.set(m.id, m);
  return map;
};

// stable variant order: createdAt, tie-broken by array position
const variantOrder = (conv: Conversation) => {
  const idx = new Map(conv.messages.map((m, i) => [m.id, i]));
  return (a: Message, b: Message) =>
    a.createdAt.localeCompare(b.createdAt) ||
    (idx.get(a.id) ?? 0) - (idx.get(b.id) ?? 0);
};

export function parentOf(conv: Conversation, m: Message): Message | null {
  if (m.parentId == null) return null;
  return conv.messages.find((x) => x.id === m.parentId) ?? null;
}

export function children(conv: Conversation, m: Message): Message[] {
  return conv.messages
    .filter((x) => x.parentId === m.id)
    .toSorted(variantOrder(conv));
}

export function siblings(conv: Conversation, m: Message): Message[] {
  const pid = m.parentId ?? null;
  return conv.messages
    .filter((x) => (x.parentId ?? null) === pid)
    .toSorted(variantOrder(conv));
}

// the conversation's current leaf: activeLeaf when it resolves, else the
// last message in array order (legacy linear default)
export function leafOf(conv: Conversation): Message | null {
  if (conv.activeLeaf != null) {
    const leaf = conv.messages.find((m) => m.id === conv.activeLeaf);
    if (leaf) return leaf;
  }
  return conv.messages.at(-1) ?? null;
}

// ancestors of `from` inclusive, root-first; cycle-guarded
export function pathToLeaf(conv: Conversation, from: Message): Message[] {
  const by = byId(conv);
  const out: Message[] = [];
  const seen = new Set<string>();
  let cur: Message | undefined = from;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    cur = cur.parentId != null ? by.get(cur.parentId) : undefined;
  }
  return out.toReversed();
}

// displayed path: ancestors of the active leaf, root-first
export function pathOf(conv: Conversation): Message[] {
  const leaf = leafOf(conv);
  return leaf ? pathToLeaf(conv, leaf) : [];
}

// deepest descendant of m following latest-created children
export function deepestLeaf(conv: Conversation, m: Message): Message {
  let cur = m;
  for (;;) {
    const kids = children(conv, cur);
    if (kids.length === 0) return cur;
    cur = kids.at(-1)!; // ordered oldest->newest
  }
}

// 1-based position of m inside its variant set
export function variantIndex(
  conv: Conversation,
  m: Message,
): { pos: number; total: number } {
  const sib = siblings(conv, m);
  const pos = sib.findIndex((x) => x.id === m.id);
  return { pos: pos < 0 ? 1 : pos + 1, total: sib.length || 1 };
}
