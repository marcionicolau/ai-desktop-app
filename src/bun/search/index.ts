// feature 007: in-memory cross-conversation search index (research D1).
// Cache is keyed by conversation.updatedAt — every mutation path bumps
// it, so refresh is incremental and staleness is impossible without
// write hooks. No persistence: a cold start rebuilds lazily per query.
import type {
  Conversation,
  SearchGroup,
  SearchHit,
} from "../../shared/types";

export interface SearchStoreLike {
  listConversations(): {
    id: string;
    title: string;
    updatedAt: string;
    personaName?: string | null;
  }[];
  getConversation(id: string): Conversation | null;
}

interface Entry {
  messageId: string;
  role: "user" | "assistant";
  timestamp: string;
  text: string; // lowercased searchable content (body + plan phase)
  source: string; // original-case, for snippet extraction
}

interface Cached {
  updatedAt: string;
  title: string;
  titleLower: string;
  personaName?: string | null;
  entries: Entry[];
}

const MAX_GROUPS = 20;
const MAX_HITS = 3;
const SNIPPET_PAD = 40; // chars of context each side of the first match

// one entry per terminal-state message; plan-phase content rides along
// for fusion turns (FR-007). Variants/dead branches are all indexed
// (flat messages[]).
function entriesOf(conv: Conversation): Entry[] {
  const out: Entry[] = [];
  for (const m of conv.messages) {
    if (m.status !== "complete" && m.status !== "partial") continue;
    const source = m.phases?.plan?.content
      ? `${m.content}\n${m.phases.plan.content}`
      : m.content;
    if (!source) continue;
    out.push({
      messageId: m.id,
      role: m.role === "user" ? "user" : "assistant",
      timestamp: m.createdAt,
      text: source.toLowerCase(),
      source,
    });
  }
  return out;
}

const allTermsIn = (text: string, terms: string[]) =>
  terms.every((t) => text.includes(t));

// snippet centered on the earliest term match, with the match's char
// range inside the returned string for <mark> rendering
function snippetOf(e: Entry, terms: string[]): SearchHit {
  let pos = -1;
  let termLen = 0;
  for (const t of terms) {
    const i = e.text.indexOf(t);
    if (i !== -1 && (pos === -1 || i < pos)) {
      pos = i;
      termLen = t.length;
    }
  }
  const from = Math.max(0, pos - SNIPPET_PAD);
  const to = Math.min(e.source.length, pos + termLen + SNIPPET_PAD);
  const snippet =
    (from > 0 ? "…" : "") +
    e.source.slice(from, to) +
    (to < e.source.length ? "…" : "");
  const off = from > 0 ? 1 : 0;
  return {
    messageId: e.messageId,
    role: e.role,
    timestamp: e.timestamp,
    snippet,
    matchStart: pos - from + off,
    matchEnd: pos - from + off + termLen,
  };
}

export class SearchIndex {
  private cache = new Map<string, Cached>();

  constructor(private store: SearchStoreLike) {}

  private refresh(): void {
    const seen = new Set<string>();
    for (const s of this.store.listConversations()) {
      seen.add(s.id);
      const c = this.cache.get(s.id);
      if (c && c.updatedAt === s.updatedAt && c.title === s.title) continue;
      const conv = this.store.getConversation(s.id);
      if (!conv) {
        this.cache.delete(s.id);
        continue;
      }
      this.cache.set(s.id, {
        updatedAt: s.updatedAt,
        title: s.title,
        titleLower: s.title.toLowerCase(),
        personaName: s.personaName ?? null,
        entries: entriesOf(conv),
      });
    }
    for (const id of this.cache.keys()) {
      if (!seen.has(id)) this.cache.delete(id); // deleted conv (FR-006)
    }
  }

  // literal multi-term AND over lowercased text; <3 chars -> empty
  query(q: string): { groups: SearchGroup[] } {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0 || q.trim().length < 3) return { groups: [] };
    this.refresh();
    const groups: SearchGroup[] = [];
    for (const [conversationId, c] of this.cache) {
      const titleMatched = allTermsIn(c.titleLower, terms);
      const hits: SearchHit[] = [];
      for (const e of c.entries) {
        if (!allTermsIn(e.text, terms)) continue;
        hits.push(snippetOf(e, terms));
        if (hits.length >= MAX_HITS) break;
      }
      if (!titleMatched && hits.length === 0) continue;
      groups.push({
        conversationId,
        title: c.title,
        updatedAt: c.updatedAt,
        personaName: c.personaName,
        titleMatched,
        hits,
      });
    }
    groups.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { groups: groups.slice(0, MAX_GROUPS) };
  }
}
